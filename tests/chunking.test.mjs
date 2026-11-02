import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { parseResponse, jsonContract, composeMessages, defaultPrompt, newSession, blankCharacter, restoreSnapshot, candidatePackets, CHUNK_HARD_MAX } from '../src/core.js';

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
const envelope = (data, plan) => JSON.stringify({ schemaVersion: 2, task: 'description', data, ...plan ? { plan } : {} });
const userText = options => options.messages.findLast(m => m.role === 'user').content;
async function make(handlers, settings = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const store = new Map(), calls = [];
  if (Object.keys(settings).length) store.set('risu-character-editor:v1:settings', JSON.stringify({ model: 'submodel', timeout: 900, theme: 'system', ...settings }));
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => store.delete(k) }, registerSetting: async () => {}, registerButton: async () => ({}), onUnload: async () => {}, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); const handler = handlers[calls.length - 1]; assert.ok(handler, 'unexpected model call #' + calls.length); const out = await handler(options, app); return typeof out === 'string' ? { type: 'success', result: out } : out; } };
  const app = new Workshop(api, dom.window.document); await app.init();
  app.confirmRetry = async () => true; // tests exercise the retry itself; the dialog is covered separately
  app.task = 'description'; app.s.draft.desc = '서론.'; app.s.requests.description = '긴 설명을 써 줘'; app.touch();
  return { app, dom, store, calls, close: () => { app.destroy(); dom.window.close(); } };
}

test('a planned response is continued automatically on a staged draft and reviewed as one multi-part proposal', async () => {
  const x = await make([
    () => envelope({ text: { edits: [{ before: '서론.', after: '서론.\n1부' }] } }, [{ title: '2부', instruction: '2부를 이어 쓴다' }, { title: '3부', instruction: '3부를 이어 쓴다' }]),
    (options, app) => { const text = userText(options); assert.match(text, /\[분할 작업 2\/3\] 이번 구간: 2부/); assert.match(text, /1부/, 'the staged draft with part 1 is the current draft'); assert.equal(app.s.draft.desc, '서론.', 'the real draft is untouched while the chain runs'); assert.match(app.job.label, /구간 2\/3/); return envelope({ text: { edits: [{ before: '1부', after: '1부\n2부' }] } }, [{ title: '3부', instruction: '3부를 이어 쓴다' }]); },
    options => { assert.match(userText(options), /\[분할 작업 3\/3\] 이번 구간: 3부/); return envelope({ text: { edits: [{ before: '2부', after: '2부\n3부' }] } }); },
  ]);
  try {
    await x.app.sendRequest();
    assert.equal(x.calls.length, 3); assert.equal(x.app.s.draft.desc, '서론.');
    const candidate = x.app.s.candidates[0]; assert.ok(candidate); assert.equal(candidatePackets(candidate).length, 3); assert.match(candidate.label, /3구간$/);
    assert.deepEqual(candidate.partLabels, ['구간 1', '구간 2 · 2부', '구간 3 · 3부']);
    assert.ok(candidate.packets.every(p => !('plan' in p)), 'stored packets carry no plan');
    assert.match(x.app.s.thread.at(-1).content, /3개 구간으로 나눠 작성/);
    assert.equal(x.dom.window.document.querySelectorAll('.candidate .diff').length, 3);
    await x.app.saveSlot('manual'); const restored = restoreSnapshot(x.app.slots.manual); assert.equal(candidatePackets(restored.candidates[0]).length, 3);
    await x.app.applyCandidate(candidate); assert.equal(x.app.s.draft.desc, '서론.\n1부\n2부\n3부');
    x.app.undoApplied(); assert.equal(x.app.s.draft.desc, '서론.');
  } finally { x.close(); }
});

test('a plan-only first answer (data null) is followed by the parts; a single part gets a plain label', async () => {
  const x = await make([
    () => envelope(null, [{ title: '전체', instruction: '본문 전체를 쓴다' }]),
    options => { assert.match(userText(options), /\[분할 작업 1\/1\] 이번 구간: 전체/); return envelope({ text: '완성된 설명' }); },
  ]);
  try {
    await x.app.sendRequest();
    assert.equal(x.calls.length, 2); const candidate = x.app.s.candidates[0];
    assert.equal(candidatePackets(candidate).length, 1); assert.doesNotMatch(candidate.label, /구간/);
    await x.app.applyCandidate(candidate); assert.equal(x.app.s.draft.desc, '완성된 설명');
  } finally { x.close(); }
});

test('cancelling mid-chain keeps the finished parts as a partial proposal', async () => {
  const x = await make([
    () => envelope({ text: { edits: [{ before: '서론.', after: '서론.\n1부' }] } }, [{ title: '2부', instruction: '2부' }, { title: '3부', instruction: '3부' }]),
    (options, app) => { app.cancelRequest(); return new Promise(() => {}); },
  ]);
  try {
    await x.app.sendRequest();
    const candidate = x.app.s.candidates[0]; assert.ok(candidate); assert.equal(candidatePackets(candidate).length, 1); assert.match(candidate.label, /1구간 \(일부\)/);
    assert.match(x.app.s.thread.at(-1).content, /일부만 완성했습니다/); assert.equal(x.app.job, null);
    await x.app.applyCandidate(candidate); assert.equal(x.app.s.draft.desc, '서론.\n1부');
  } finally { x.close(); }
});

test('a truncated answer is retried once with a smaller-part instruction', async () => {
  const whole = envelope({ text: '아주 긴 본문 '.repeat(80) });
  const x = await make([
    () => whole.slice(0, Math.floor(whole.length * 0.6)),
    options => { assert.match(userText(options), /직전 응답이 중간에 끊겼다/); return envelope({ text: '짧은 첫 구간' }); },
  ]);
  try {
    await x.app.sendRequest();
    assert.equal(x.calls.length, 2); assert.equal(x.app.s.candidates.length, 1);
    assert.match(x.app.s.thread.at(-1).content, /응답이 끊겨 더 작은 구간으로 다시 요청/);
    assert.equal(x.app.s.thread.at(-1).error, undefined);
  } finally { x.close(); }
});

test('with chunking off a plan is noted but not followed, and the contract forbids plan', async () => {
  const x = await make([() => envelope({ text: '1부만' }, [{ title: '2부', instruction: '2부' }])], { chunking: false });
  try {
    assert.equal(x.app.settings.chunking, false);
    await x.app.sendRequest();
    assert.equal(x.calls.length, 1); assert.equal(x.app.s.candidates.length, 1);
    assert.match(x.app.s.thread.at(-1).content, /긴 응답 나눠 받기/);
    assert.match(x.calls[0].messages[0].content, /plan 필드는 사용하지 마라/);
  } finally { x.close(); }
});

test('the chain stops at the configured maximum number of parts', async () => {
  const x = await make([
    () => envelope({ text: { edits: [{ before: '서론.', after: '서론.\n1' }] } }, [{ title: 'a', instruction: 'a' }, { title: 'b', instruction: 'b' }, { title: 'c', instruction: 'c' }]),
    () => envelope({ text: { edits: [{ before: '1', after: '1\n2' }] } }, [{ title: 'b', instruction: 'b' }, { title: 'c', instruction: 'c' }]),
  ], { chunkMax: 2, chunkTokens: 1000 });
  try {
    assert.equal(x.app.settings.chunkMax, 2);
    await x.app.sendRequest();
    assert.equal(x.calls.length, 2); assert.equal(candidatePackets(x.app.s.candidates[0]).length, 2);
    assert.match(x.app.s.thread.at(-1).content, /최대 구간 수\(2\)에 도달/);
    assert.match(x.calls[0].messages[0].content, /약 1,000토큰/);
  } finally { x.close(); }
});

test('lorebook chains address entries by their staged refs and extend the request selection', async () => {
  const lore = data => JSON.stringify({ schemaVersion: 2, task: 'lorebook', data, plan: data.upsert[0]?.ref === null ? [{ title: '보강', instruction: '새 항목 보강' }] : undefined });
  const x = await make([
    () => lore({ upsert: [{ ref: null, entry: { comment: 'B', key: 'b', content: 'b1' } }], remove: [] }),
    () => lore({ upsert: [{ ref: 'l1', entry: { content: { edits: [{ before: 'b1', after: 'b1 b2' }] } } }], remove: [] }),
  ]);
  try {
    x.app.task = 'lorebook'; x.app.s.draft.globalLore = [{ comment: 'A', key: 'a', content: 'a', secondkey: '' }]; x.app.s.loreIncluded = [true]; x.app.s.requests.lorebook = '로어북 확장'; x.app.touch();
    await x.app.sendRequest();
    assert.equal(x.calls.length, 2); const candidate = x.app.s.candidates[0]; assert.equal(candidatePackets(candidate).length, 2);
    assert.equal(x.app.s.draft.globalLore.length, 1);
    await x.app.applyCandidate(candidate);
    assert.equal(x.app.s.draft.globalLore.length, 2); assert.equal(x.app.s.draft.globalLore[1].content, 'b1 b2'); assert.deepEqual(x.app.s.loreIncluded, [true, true]);
  } finally { x.close(); }
});

test('plan validation: shape limits, null data needs a plan, plan survives lore compaction', () => {
  const draft = blankCharacter();
  assert.throws(() => parseResponse(envelope(null), 'description', draft), /data가 null이면 plan이 필요합니다/);
  assert.throws(() => parseResponse(envelope({ text: 'x' }, [{ title: '', instruction: 'y' }]), 'description', draft), /plan\.title/);
  assert.throws(() => parseResponse(envelope({ text: 'x' }, [{ title: 't', instruction: 'y', extra: 1 }]), 'description', draft), /허용하지 않는 필드: extra/);
  assert.throws(() => parseResponse(envelope({ text: 'x' }, Array.from({ length: CHUNK_HARD_MAX + 1 }, (_, i) => ({ title: 't' + i, instruction: 'y' }))), 'description', draft), /plan은 1~/);
  const ok = parseResponse(envelope({ text: 'x' }, [{ title: 't', instruction: 'y' }]), 'description', draft); assert.equal(ok.plan.length, 1);
  draft.globalLore = [{ comment: 'A', key: 'a', content: 'a' }];
  const packed = parseResponse(JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: { upsert: [{ ref: 'l0', entry: { content: 'a2' } }], remove: [] }, plan: [{ title: 't', instruction: 'y' }] }), 'lorebook', draft);
  assert.equal(packed.plan.length, 1);
  assert.match(jsonContract('description'), /\[분할 작업\][\s\S]*약 5,000토큰/);
  assert.match(jsonContract('description', { chunking: false }), /plan 필드는 사용하지 마라/);
  assert.match(composeMessages(newSession(), 'greeting', '요청', defaultPrompt('greeting'), { chunkTokens: 2500 })[0].content, /약 2,500토큰/);
  assert.match(defaultPrompt('workshop').system, /plan 구간으로 넘겨라/);
});
