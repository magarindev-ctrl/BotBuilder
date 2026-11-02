import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { parseResponse, applyPacket, blankCharacter, TruncatedResponseError, BlockReferenceError, candidatePackets } from '../src/core.js';

const block = (name, body) => `<<<${name}>>>\n${body}\n<<</${name}>>>`;
const salvage = { salvage: true };
const loreDraft = () => { const c = blankCharacter(); c.globalLore = [{ comment: 'A', key: 'a', content: 'a 본문', secondkey: '' }, { comment: 'B', key: 'b', content: 'b 본문', secondkey: '' }]; return c; };

test('items whose block never arrived are dropped and listed; the rest is kept and applies', () => {
  const c = loreDraft();
  const env = JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: { upsert: [
    { ref: 'l0', entry: { content: { block: 'c0' } } },
    { ref: null, entry: { comment: '새', key: 'n', content: { block: 'c1' } } },
    { ref: 'l1', entry: { comment: { block: 'cm' }, content: { block: 'c2' } } },
  ], remove: [] } });
  const raw = env + '\n' + block('c0', 'a 본문 수정') + '\n' + block('cm', 'B 제목');
  assert.throws(() => parseResponse(raw, 'lorebook', c), (e) => e instanceof TruncatedResponseError, 'strict mode still reports truncation');
  const packet = parseResponse(raw, 'lorebook', c, false, salvage);
  assert.deepEqual(packet.missing, [{ label: '로어북 새 항목 2 content', block: 'c1' }, { label: '로어북 l1 content', block: 'c2' }]);
  assert.equal(packet.data.upsert.length, 2);
  const next = applyPacket(c, packet);
  assert.equal(next.globalLore[0].content, 'a 본문 수정'); assert.equal(next.globalLore[1].comment, 'B 제목'); assert.equal(next.globalLore[1].content, 'b 본문'); assert.equal(next.globalLore.length, 2);
});

test('one missing edit is dropped while the other edits of the same field apply; an unclosed block counts as missing', () => {
  const c = blankCharacter(); c.desc = '첫째 줄\n둘째 줄\n셋째 줄';
  const env = JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: { edits: [{ before: { block: 'b1' }, after: { block: 'a1' } }, { before: { block: 'b2' }, after: { block: 'a2' } }] } } });
  const raw = env + '\n' + block('b1', '첫째 줄') + '\n' + block('a1', '1번 줄') + '\n' + block('b2', '셋째 줄') + '\n<<<a2>>>\n3번 줄 그리고 끊';
  assert.throws(() => parseResponse(raw, 'description', c), (e) => e instanceof TruncatedResponseError);
  const packet = parseResponse(raw, 'description', c, false, salvage);
  assert.equal(applyPacket(c, packet).desc, '1번 줄\n둘째 줄\n셋째 줄');
  assert.equal(packet.missing.length, 2); assert.equal(packet.missing[0].label, '캐릭터 설명 본문 부분편집 2'); assert.match(packet.missing[1].block, /a2 \(닫히지 않음/);
});

test('when nothing usable remains the strict error stands; unreferenced blocks are still a format error', () => {
  const c = blankCharacter();
  const whole = JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: { block: 't' } } });
  assert.throws(() => parseResponse(whole + '\n설명이 이어집니다.', 'description', c, false, salvage), (e) => e instanceof BlockReferenceError, 'no block at all and prose after the JSON: a format error, not truncation');
  assert.throws(() => parseResponse(whole, 'description', c, false, salvage), (e) => e instanceof TruncatedResponseError, 'ends right after the JSON: the block never came');
  assert.throws(() => parseResponse(whole + '\n<<<t>>>\n잘림', 'description', c, false, salvage), (e) => e instanceof TruncatedResponseError);
  const stray = JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: 'ok' } }) + '\n' + block('x', 'unused');
  assert.throws(() => parseResponse(stray, 'description', c, false, salvage), (e) => e.blocks === true && /참조하지 않는 블록/.test(e.message));
  const lua = JSON.stringify({ schemaVersion: 2, task: 'lua', data: { scripts: [{ ref: null, comment: '새', code: { block: 'k' } }], removeScripts: [], variables: { a: { block: 'v' } }, removeVariables: [] } }) + '\n' + block('v', '1');
  const packet = parseResponse(lua, 'lua', c, false, salvage);
  assert.equal(packet.data.scripts.length, 0); assert.deepEqual(packet.data.variables, { a: '1' }); assert.equal(packet.missing[0].label, 'Lua 새 항목 1 code');
});

test('inside a workshop answer a change that loses its only item is removed; other changes and the reply stay', () => {
  const c = loreDraft();
  const env = JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '설명과 로어북 제안', changes: [
    { task: 'description', data: { text: { block: 'd' } } },
    { task: 'lorebook', data: { upsert: [{ ref: null, entry: { comment: '새', key: 'n', content: { block: 'c' } } }], remove: [] } },
  ] } });
  const packet = parseResponse(env + '\n' + block('d', '새 설명'), 'workshop', c, false, salvage);
  assert.equal(packet.data.changes.length, 1); assert.equal(packet.data.changes[0].task, 'description');
  assert.deepEqual(packet.missing, [{ label: '로어북 새 항목 1 content', block: 'c' }]);
});

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
const userText = options => options.messages.findLast(m => m.role === 'user').content;
async function make(handlers, settings = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const store = new Map(), calls = [];
  if (Object.keys(settings).length) store.set('risu-character-editor:v1:settings', JSON.stringify({ model: 'submodel', timeout: 900, theme: 'system', ...settings }));
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => store.delete(k) }, registerSetting: async () => {}, registerButton: async () => ({}), onUnload: async () => {}, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); const handler = handlers[calls.length - 1]; assert.ok(handler, 'unexpected model call #' + calls.length); const out = await handler(options, app); return typeof out === 'string' ? { type: 'success', result: out } : out; } };
  const app = new Workshop(api, dom.window.document); await app.init();
  app.task = 'lorebook'; app.s.draft.globalLore = [{ comment: 'A', key: 'a', content: 'a 본문', secondkey: '' }]; app.s.loreIncluded = [true]; app.s.requests.lorebook = '로어북 두 개 추가'; app.touch();
  return { app, dom, calls, close: () => { app.destroy(); dom.window.close(); } };
}
const twoItems = JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: { upsert: [{ ref: null, entry: { comment: '하나', key: 'one', content: { block: 'c1' } } }, { ref: null, entry: { comment: '둘', key: 'two', content: { block: 'c2' } } }], remove: [] } }) + '\n' + block('c1', '하나 본문') + '\n';

test('a missing block yields a usable card, then one follow-up for just the missing item after the user agrees; declining keeps the partial card', async () => {
  const asked = [];
  const x = await make([
    () => twoItems,
    (options) => { const text = userText(options); assert.match(text, /\[결손 보충\]/); assert.match(text, /로어북 새 항목 2 content \(블록 c2\)/); assert.match(text, /"ref":"l1"/, 'the staged draft already holds the first new entry'); return JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: { upsert: [{ ref: null, entry: { comment: '둘', key: 'two', content: '둘 본문' } }], remove: [] } }); },
  ]);
  x.app.confirmRetry = async (purpose, error, hint) => { asked.push({ purpose, message: error.message, hint }); return true; };
  try {
    await x.app.sendRequest(); await wait();
    assert.equal(x.calls.length, 2); assert.equal(asked.length, 1); assert.match(asked[0].purpose, /블록 1개가 오지 않았습니다/); assert.match(asked[0].hint, /결손 보충/);
    const candidate = x.app.s.candidates[0]; assert.equal(candidatePackets(candidate).length, 2); assert.deepEqual(candidate.partLabels, ['구간 1', '결손 보충']);
    assert.match(x.app.s.thread.at(-1).content, /빠진 항목 1개를 다시 요청해 받았습니다/);
    await x.app.applyCandidate(candidate); assert.deepEqual(x.app.s.draft.globalLore.map(l => l.content), ['a 본문', '하나 본문', '둘 본문']);
  } finally { x.close(); }
  const y = await make([() => twoItems]);
  y.app.confirmRetry = async () => false;
  try {
    await y.app.sendRequest(); await wait();
    assert.equal(y.calls.length, 1); const candidate = y.app.s.candidates[0]; assert.equal(candidatePackets(candidate).length, 1);
    assert.deepEqual(candidate.missing, ['로어북 새 항목 2 content']);
    assert.match(y.app.s.thread.at(-1).content, /빠진 항목 1개는 다시 요청하지 않았습니다/);
    assert.match(y.dom.window.document.querySelector('.candidate').textContent, /빠진 항목 1개/);
    await y.app.applyCandidate(candidate); assert.equal(y.app.s.draft.globalLore.length, 2);
  } finally { y.close(); }
});

test('the follow-up counts toward the part budget and is skipped when the budget is spent', async () => {
  const x = await make([
    () => JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: { upsert: [{ ref: null, entry: { comment: '하나', key: 'one', content: '하나 본문' } }], remove: [] }, plan: [{ title: '둘', instruction: '둘째 항목' }] }),
    () => twoItems.replace('"comment":"하나","key":"one"', '"comment":"셋","key":"three"'),
  ], { chunkMax: 2, chunkTokens: 1000 });
  let asked = 0; x.app.confirmRetry = async () => { asked++; return true; };
  try {
    await x.app.sendRequest(); await wait();
    assert.equal(x.calls.length, 2); assert.equal(asked, 0);
    assert.match(x.app.s.thread.at(-1).content, /최대 구간 수\(2\)에 도달해 다시 요청하지 않았습니다/);
    assert.equal(candidatePackets(x.app.s.candidates[0]).length, 2);
  } finally { x.close(); }
});
