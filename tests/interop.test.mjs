import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { registerInterop, normalizeInterop, INTEROP_KEYS, INTEROP_ACTION_TTL_MS, INTEROP_POLL_MS, INTEROP_ACTION_POLL_MS, DA_WORKSHOP_INTEROP_MARK } from '../src/interop.js';
import { Workshop } from '../src/ui.js';
import { FIELDS } from '../src/core.js';

const ID = 'test-plugin';
function harness({ initial = {}, start = 1_000_000 } = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const storage = { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => store.delete(k) };
  const clock = { now: start }; let hidden = false; const intervals = [];
  const timers = { setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval: id => { intervals[id - 1] = null; } };
  const reg = () => JSON.parse(store.get(INTEROP_KEYS.reg + ID));
  const request = (key, rev, args, at = clock.now) => store.set(INTEROP_KEYS.action + ID, JSON.stringify({ rev, key, args, updatedAt: at }));
  return { store, storage, clock, intervals, reg, request, options: { now: () => clock.now, visible: () => !hidden, timers }, hide: v => { hidden = v; } };
}
const register = (h, extra = {}) => registerInterop(h.storage, { id: ID, name: '테스트', version: '9.9.9', pluginName: 'test_plugin', actions: [{ key: 'open', label: '열기', run: async () => ({ opened: true }) }], ...extra }, h.options);

test('registration publishes the reg entry with spec, actions and zero revisions, and nothing else is written', async () => {
  const h = harness(); const handle = await register(h);
  const entry = h.reg();
  assert.equal(entry.spec, 1); assert.equal(entry.id, ID); assert.equal(entry.version, '9.9.9'); assert.equal(entry.pluginName, 'test_plugin');
  assert.deepEqual(entry.actions, [{ key: 'open', label: '열기', description: '' }]);
  assert.deepEqual([entry.appliedRev, entry.actionRev, entry.lastError], [0, 0, null]); assert.deepEqual(entry.fields, []); assert.deepEqual(entry.values, {});
  assert.deepEqual([...h.store.keys()], [INTEROP_KEYS.reg + ID]);
  assert.deepEqual(h.intervals.map(i => i.ms), [INTEROP_POLL_MS, INTEROP_ACTION_POLL_MS]);
  handle.stop(); assert.deepEqual(h.intervals, [null, null]);
});

test('a fresh action runs exactly once and its result is published with the revision', async () => {
  const h = harness(); let runs = 0;
  const handle = await register(h, { actions: [{ key: 'open', label: '열기', run: async (args, meta) => { runs++; assert.deepEqual(args, { from: 'dusk' }); assert.equal(meta.source, 'dusk-atelier'); return { opened: true }; } }] });
  h.request('open', 3, { from: 'dusk' }); await handle.poll();
  let entry = h.reg(); assert.equal(runs, 1); assert.equal(entry.actionRev, 3); assert.equal(entry.actionKey, 'open'); assert.deepEqual(entry.actionResult, { opened: true }); assert.equal(entry.actionError, null);
  await handle.poll(); assert.equal(runs, 1, 'the same revision never runs twice');
  h.request('open', 2); await handle.poll(); assert.equal(runs, 1, 'an older revision is ignored');
  handle.stop();
});

test('stale requests at startup and later are acknowledged as expired without running', async () => {
  const stale = { rev: 7, key: 'open', updatedAt: 1_000_000 - INTEROP_ACTION_TTL_MS - 1 };
  const h = harness({ initial: { [INTEROP_KEYS.action + ID]: stale } }); let runs = 0;
  const handle = await register(h, { actions: [{ key: 'open', label: '열기', run: async () => { runs++; return {}; } }] });
  let entry = h.reg(); assert.equal(runs, 0); assert.equal(entry.actionRev, 7); assert.equal(entry.actionError, 'expired'); assert.equal(entry.actionResult, null);
  h.request('open', 8, null, h.clock.now - INTEROP_ACTION_TTL_MS - 1); await handle.poll();
  entry = h.reg(); assert.equal(runs, 0); assert.equal(entry.actionRev, 8); assert.equal(entry.actionError, 'expired');
  h.request('open', 9, null, h.clock.now - INTEROP_ACTION_TTL_MS); await handle.poll();
  assert.equal(runs, 1, 'a request exactly at the TTL edge still runs');
  handle.stop();
});

test('unknown keys, throwing actions and oversized results are reported without breaking the plugin', async () => {
  const h = harness();
  const handle = await register(h, { actions: [
    { key: 'open', label: '열기', run: async () => ({ opened: true }) },
    { key: 'boom', run: async () => { throw new Error('터짐'); } },
    { key: 'big', run: async () => ({ blob: 'x'.repeat(1048576) }) },
  ] });
  h.request('nope', 1); await handle.poll(); assert.equal(h.reg().actionError, 'unknown action: nope');
  h.request('boom', 2); await handle.poll(); assert.equal(h.reg().actionError, '터짐');
  h.request('big', 3); await handle.poll(); assert.equal(h.reg().actionError, 'result too large'); assert.equal(h.reg().actionResult, null);
  h.request('open', 4); await handle.poll(); assert.deepEqual([h.reg().actionError, h.reg().actionResult], [null, { opened: true }]);
  handle.stop();
});

test('polling is skipped while the document is hidden and resumes when visible', async () => {
  const h = harness(); let runs = 0;
  const handle = await register(h, { actions: [{ key: 'open', label: '열기', run: async () => { runs++; return {}; } }] });
  // Intervals share one busy flag, so fire them one at a time as the browser would.
  const tick = async () => { for (const i of h.intervals.filter(Boolean)) { i.fn(); await new Promise(r => setTimeout(r, 5)); } };
  h.request('open', 1); h.hide(true); await tick(); assert.equal(runs, 0);
  h.hide(false); await tick(); assert.equal(runs, 1);
  handle.stop();
});

test('settings patches are acknowledged even though 봇빌더 registers no fields, and revisions survive a re-registration', async () => {
  const h = harness({ initial: { [INTEROP_KEYS.patch + ID]: { rev: 2, values: { a: 1 } } } });
  const handle = await register(h); assert.equal(h.reg().appliedRev, 2); handle.stop();
  h.request('open', 5); const again = await register(h); assert.equal(h.reg().appliedRev, 2); assert.equal(h.reg().actionRev, 5, 'a fresh request found at startup runs on registration');
  again.stop();
});

test('configuration validation rejects bad ids and configs without actions or apply; missing storage skips quietly', async () => {
  assert.throws(() => normalizeInterop({ id: 'Bad Id', actions: [{ key: 'open', run: async () => {} }] }), /id 형식 오류/);
  assert.throws(() => normalizeInterop({ id: 'ok-id' }), /apply 함수가 필요합니다/);
  assert.deepEqual(normalizeInterop({ id: 'ok-id', actions: [{ key: 'open', run: async () => {} }, { key: 'Bad Key', run: async () => {} }, { key: 'norun' }] }).actions.map(a => a.key), ['open']);
  assert.equal(await registerInterop(null, { id: 'ok-id', actions: [{ key: 'open', run: async () => {} }] }), null);
  assert.equal(DA_WORKSHOP_INTEROP_MARK, '/*__DA_WORKSHOP_INTEROP__*/');
});

test('봇빌더 registers itself for Dusk Atelier and answers open and draft requests read-only', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  dom.window.matchMedia = query => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const store = new Map(); const shows = [];
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => store.delete(k) }, registerSetting: async () => {}, registerButton: async () => ({}), onUnload: async () => {}, showContainer: async mode => shows.push(mode), hideContainer: async () => {}, runLLMModel: async () => ({ type: 'success', result: '{}' }) };
  const app = new Workshop(api, dom.window.document); await app.init();
  try {
    const handle = await app.interopReady; assert.ok(handle, 'registration handle');
    const regKey = INTEROP_KEYS.reg + 'risu-story-workshop', entry = () => JSON.parse(store.get(regKey));
    assert.equal(entry().pluginName, 'risu_story_workshop'); assert.deepEqual(entry().actions.map(a => a.key), ['open', 'draft']);
    assert.match(entry().version, /^\d+\.\d+\.\d+$/);
    const ask = (key, rev) => store.set(INTEROP_KEYS.action + 'risu-story-workshop', JSON.stringify({ rev, key, updatedAt: Date.now() }));
    ask('draft', 1); await handle.poll();
    let result = entry().actionResult;
    assert.deepEqual(Object.keys(result).sort(), ['dirty', 'draft', 'name', 'savedAt', 'started', 'targetId']);
    assert.equal(result.started, false); assert.equal(result.dirty, false); assert.equal(result.targetId, null); assert.equal(result.savedAt, null);
    assert.ok(Object.keys(result.draft).every(k => FIELDS.includes(k)), 'draft carries editable fields only');
    assert.ok(!('chats' in result.draft) && !('chaId' in result.draft));
    app.setField('desc', '원고를 고침'); const before = JSON.stringify(app.s.draft);
    ask('draft', 2); await handle.poll();
    result = entry().actionResult; assert.equal(result.dirty, true); assert.equal(result.started, true); assert.equal(result.draft.desc, '원고를 고침');
    assert.equal(JSON.stringify(app.s.draft), before, 'reading the draft changes nothing');
    ask('open', 3); await handle.poll();
    assert.deepEqual(entry().actionResult, { opened: true }); assert.deepEqual(shows, ['fullscreen']);
    assert.equal([...store.keys()].filter(k => k.startsWith('da_interop:reg:')).length, 1);
  } finally { app.destroy(); dom.window.close(); }
});
