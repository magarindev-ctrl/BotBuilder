import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { composeMessages, newSession, defaultPrompt, LEGACY_USER_TEMPLATE, CACHE_ACK, clone } from '../src/core.js';

const session = () => { const s = newSession(); s.draft.desc = '설명 본문'; s.thread.push({ role: 'user', content: '이전 질문' }, { role: 'assistant', content: '이전 답' }); s.candidates.push({ id: 'c', packet: { task: 'description', data: { text: '제안 본문' } }, before: clone(s.draft) }); return s; };

test('with cacheSplit the stable prefix is its own user message with a cache point, an assistant acknowledgement separates it, and the changing tail ends with the request', () => {
  const s = session();
  const messages = composeMessages(s, 'description', '이번 요청', defaultPrompt('description'), { cacheSplit: true });
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(messages[1].cachePoint, true); assert.equal(messages[3].cachePoint, undefined); assert.equal(messages[2].content, CACHE_ACK);
  const head = messages[1].content, tail = messages[3].content;
  for (const label of ['[작업 종류]', '[현재안]', '[참고자료]', '[출력 형식]']) assert.ok(head.includes(label), label + ' in head');
  for (const label of ['[설계 대화 기록]', '[미적용 제안]', '[사용자 요청사항]']) assert.ok(tail.includes(label), label + ' in tail');
  assert.doesNotMatch(head, /이전 답|제안 본문|이번 요청/); assert.match(tail, /이전 답/); assert.match(tail, /제안 본문/); assert.ok(tail.trimEnd().endsWith('이번 요청'));
  // Same draft, another request: the cached head is byte-identical; only the tail differs.
  const again = composeMessages(s, 'description', '다른 요청', defaultPrompt('description'), { cacheSplit: true });
  assert.equal(again[1].content, head); assert.notEqual(again[3].content, tail);
  // The two halves are exactly the single message of the unsplit form.
  const single = composeMessages(s, 'description', '이번 요청', defaultPrompt('description'))[1].content;
  assert.equal(head + '\n\n' + tail, single);
});

test('no split without the option, with an old template that has no conversation slot, or in a template whose slot has nothing before it', () => {
  const s = session();
  assert.equal(composeMessages(s, 'description', '요청', defaultPrompt('description')).length, 2);
  assert.equal(composeMessages(s, 'description', '요청', { ...defaultPrompt('description'), user: LEGACY_USER_TEMPLATE }, { cacheSplit: true }).length, 2);
  const odd = { ...defaultPrompt('description'), user: '<<CONVERSATION>>\n<<TASK_NAME>> <<CURRENT_DRAFT>> <<REFERENCE_CONTEXT>> <<OUTPUT_FORMAT>>\n<<USER_REQUEST>>' };
  assert.equal(composeMessages(s, 'description', '요청', odd, { cacheSplit: true }).length, 2);
  assert.ok(composeMessages(s, 'description', '요청', odd, { cacheSplit: true }).every(m => m.cachePoint === undefined));
});

async function make() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const store = new Map(), calls = [];
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => store.delete(k) }, registerSetting: async () => {}, registerButton: async () => ({}), onUnload: async () => {}, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); return { type: 'success', result: JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: '새 설명' } }) }; } };
  const app = new Workshop(api, dom.window.document); await app.init();
  app.task = 'description'; app.s.draft.desc = '서론.'; app.s.requests.description = '설명을 써 줘'; app.touch();
  return { app, dom, calls, close: () => { app.destroy(); dom.window.close(); } };
}

test('direct-mode requests are sent split with the cache point; images ride on the tail; preset mode is untouched', async () => {
  const x = await make();
  try {
    const preview = x.app.previewRequest('description');
    assert.equal(preview.messages.length, 4); assert.equal(preview.messages[1].cachePoint, true); assert.equal(preview.messages[3].role, 'user');
    x.app.s.requestImages = { description: [{ id: 'i', name: 'a.png', mime: 'image/png', data: 'data:image/png;base64,AAAA', size: 4, width: 4, height: 3 }] };
    const withImage = x.app.previewRequest('description');
    assert.equal(withImage.messages[3].multimodals?.length, 1); assert.equal(withImage.messages[1].multimodals, undefined);
    await x.app.sendRequest();
    assert.equal(x.calls.length, 1); assert.equal(x.calls[0].messages.length, 4); assert.equal(x.calls[0].messages[1].cachePoint, true);
    assert.equal(x.app.s.candidates.length, 1);
  } finally { x.close(); }
});
