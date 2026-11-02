import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { composeMessages, newSession, defaultPrompt, recentConversation, historyOptions, draftSummary, focusContext, contextOf, requestLorebook, HISTORY_TURNS_DEFAULT } from '../src/core.js';

const lore = (n, size = 600) => Array.from({ length: n }, (_, i) => ({ comment: '항목 ' + i, key: 'k' + i, content: ('로어 ' + i + ' ').repeat(size).slice(0, size), secondkey: '' }));
const thread = (turns) => Array.from({ length: turns * 2 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: (i % 2 ? '답 ' : '질문 ') + i }));
const userText = (messages) => messages.filter(m => m.role === 'user').map(m => m.content).join('\n');

test('only the most recent turns of the conversation are sent; older ones become a one-line note without a summary', () => {
  const all = thread(20);
  const recent = recentConversation(all, 3);
  assert.equal(recent.length, 7); assert.match(recent[0].note, /이전 대화 34개는 보내지 않았다/); assert.equal(recent.at(-1).content, '답 39'); assert.equal(recent[1].content, '질문 34');
  assert.equal(recentConversation(thread(3), 3).length, 6, 'nothing omitted when it fits');
  assert.equal(recentConversation(thread(13), HISTORY_TURNS_DEFAULT).length, 25);
  assert.deepEqual(historyOptions({}), { historyTurns: 12 }); assert.deepEqual(historyOptions({ historyTurns: 0 }), { historyTurns: 12 }); assert.deepEqual(historyOptions({ historyTurns: 5 }), { historyTurns: 5 });
  const s = newSession(); s.thread.push(...thread(20));
  const text = userText(composeMessages(s, 'description', '요청', defaultPrompt('description'), { historyTurns: 2 }));
  assert.match(text, /이전 대화 36개는 보내지 않았다/); assert.match(text, /질문 36/); assert.doesNotMatch(text, /질문 35"/);
});

test('workshop summary mode sends field sizes and an index instead of bodies, with a note that edits are not possible', () => {
  const s = newSession(); s.draft.desc = '설명 본문입니다.'; s.draft.firstMessage = '첫 메시지'; s.draft.globalLore = lore(3); s.loreIncluded = [true, true, true];
  const context = contextOf(s.draft); context.lorebook = requestLorebook(s);
  const summary = draftSummary(s, context);
  assert.equal(summary.summaryMode, true); assert.equal(summary.fields.description.chars, 9); assert.equal(summary.lorebook.length, 3); assert.equal(summary.lorebook[0].chars, 600); assert.equal(summary.lorebook[0].content, undefined);
  const text = userText(composeMessages(s, 'workshop', '방향 논의', defaultPrompt('workshop'), { draftSummary: true }));
  assert.match(text, /"summaryMode":true/); assert.doesNotMatch(text, /설명 본문입니다/); assert.doesNotMatch(text, /로어 0 로어 0/); assert.match(text, /요약 모드: 원고 본문은 보내지 않았다/); assert.match(text, /요약\(필드 길이와 항목 색인\)으로만/);
  assert.doesNotMatch(userText(composeMessages(s, 'description', '요청', defaultPrompt('description'), { draftSummary: true })), /summaryMode/, 'summary applies to workshop only');
});

test('a focused context sends changed fields and items whole and the rest as sizes, in the draft and in the reference', () => {
  const s = newSession(); s.draft.desc = '바뀐 설명'; s.draft.personality = '그대로인 성격'; s.draft.globalLore = lore(3, 50); s.loreIncluded = [true, true, true];
  s.draft.customscript = [{ comment: '규칙', in: 'a', out: 'b', type: 'editdisplay', flag: 'g', ableFlag: true }];
  const context = contextOf(s.draft); context.lorebook = requestLorebook(s);
  const focused = focusContext('workshop', context, null, { fields: ['description'], lore: [1], regex: [], scripts: [] });
  assert.equal(focused.description, '바뀐 설명'); assert.deepEqual(focused.personality, { omitted: true, chars: 7 });
  assert.equal(focused.lorebook[1].entry.content, context.lorebook[1].entry.content); assert.deepEqual(focused.lorebook[0], { ref: 'l0', summary: { comment: '항목 0', key: 'k0', chars: 50 } });
  assert.deepEqual(focused.regex[0].summary, { comment: '규칙', type: 'editdisplay', chars: 2 }); assert.match(focused.focusNote, /바뀐 필드·항목만 본문을 보냈고/);
  const text = userText(composeMessages(s, 'lorebook', '요청', defaultPrompt('lorebook'), { focus: { fields: ['description'], lore: [1] } }));
  assert.match(text, /"entries":\[\{"ref":"l0","summary"/); assert.match(text, /"personality":\{"omitted":true,"chars":7\}/, 'the reference character is focused too');
  // With real-sized entries the focused request is far smaller; tiny entries would not outweigh the note and markers.
  const big = newSession(); big.draft.globalLore = lore(20, 1500); big.loreIncluded = Array(20).fill(true);
  const bigFocused = userText(composeMessages(big, 'lorebook', '요청', defaultPrompt('lorebook'), { focus: { fields: [], lore: [0] } })), bigFull = userText(composeMessages(big, 'lorebook', '요청', defaultPrompt('lorebook')));
  assert.ok(bigFocused.length < bigFull.length * 0.3, `${bigFocused.length} vs ${bigFull.length}`);
  assert.equal(focusContext('description', context, context.description, { fields: [] }), context.description, 'the task field itself is always whole');
});

async function make(handlers, settings = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const store = new Map(), calls = [];
  if (Object.keys(settings).length) store.set('risu-character-editor:v1:settings', JSON.stringify({ model: 'submodel', timeout: 900, theme: 'system', ...settings }));
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => store.delete(k) }, registerSetting: async () => {}, registerButton: async () => ({}), onUnload: async () => {}, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); const handler = handlers[calls.length - 1]; assert.ok(handler, 'unexpected model call #' + calls.length); const out = await handler(options, app); return typeof out === 'string' ? { type: 'success', result: out } : out; } };
  const app = new Workshop(api, dom.window.document); await app.init();
  app.confirmRetry = async () => true;
  return { app, dom, store, calls, close: () => { app.destroy(); dom.window.close(); } };
}
const ws = (changes, plan) => JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '진행', changes }, ...plan ? { plan } : {} });

test('chunk steps send the changed fields whole and the untouched ones as sizes; the first request sends everything', async () => {
  const x = await make([
    (options) => { const text = userText(options.messages); assert.match(text, /"personality":"고정 성격"/); return ws([{ task: 'description', data: { text: { edits: [{ before: '서론.', after: '서론.\n1부' }] } } }], [{ title: '2부', instruction: '2부' }]); },
    (options) => { const text = userText(options.messages); assert.match(text, /"description":"서론\.\\n1부"/); assert.match(text, /"personality":\{"omitted":true,"chars":5\}/); assert.match(text, /분할 작업 구간 요청: 이전 구간에서 바뀐 필드/); return ws([{ task: 'description', data: { text: { edits: [{ before: '1부', after: '1부\n2부' }] } } }]); },
  ]);
  try {
    x.app.task = 'workshop'; x.app.s.draft.desc = '서론.'; x.app.s.draft.personality = '고정 성격'; x.app.s.requests.workshop = '설명을 길게'; x.app.touch();
    await x.app.sendRequest();
    assert.equal(x.calls.length, 2); assert.equal(x.app.s.candidates.length, 1);
  } finally { x.close(); }
});

test('the settings normalize the history cap and the workshop summary flag lives in the session', async () => {
  const x = await make([], { historyTurns: 999 });
  try {
    assert.equal(x.app.settings.historyTurns, 12);
    x.app.task = 'workshop'; x.app.s.draft.desc = '본문'; x.app.s.requests.workshop = '요청'; x.app.s.workshopSummary = true; x.app.touch();
    assert.match(userText(x.app.previewRequest('workshop').messages), /"summaryMode":true/);
    x.app.render(); assert.match(x.dom.window.document.body.textContent, /원고 전체 대신 요약만 보내기/);
  } finally { x.close(); }
});

test('input size on the memo scenarios: history cap, summary mode and focused steps each cut the request', () => {
  const s = newSession(); s.draft.globalLore = lore(40, 600); s.loreIncluded = Array(40).fill(true); s.thread.push(...thread(10));
  const size = (task, options = {}) => composeMessages(s, task, '로어북을 손봐 줘', defaultPrompt(task), options).reduce((n, m) => n + m.content.length, 0);
  const base = size('lorebook'), capped = size('lorebook', { historyTurns: 3 }), focused = size('lorebook', { focus: { lore: [0, 1], fields: [] } });
  const wsBase = size('workshop'), wsSummary = size('workshop', { draftSummary: true });
  const empty = newSession();
  const fixed = composeMessages(empty, 'lorebook', '요청', defaultPrompt('lorebook')).reduce((n, m) => n + m.content.length, 0);
  console.log(`[size] 고정 오버헤드(빈 원고, 로어북 요청) ${fixed}자 · 로어북 40개×600자+대화 10턴: 기본 ${base}자 → 대화 3턴 ${capped}자 → 구간 요청(2개 항목만 본문) ${focused}자 · 설계 대화: 전체 ${wsBase}자 → 요약 ${wsSummary}자`);
  assert.ok(capped < base); assert.ok(focused < base * 0.6, 'focused step under 60% of the full request'); assert.ok(wsSummary < wsBase * 0.5, 'summary mode under half of the full workshop request');
});
