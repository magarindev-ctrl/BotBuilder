import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { parseResponse, applyPacket, blankCharacter, extractBlocks, applyBlocks, JsonSyntaxError, TruncatedResponseError, composeMessages, newSession, defaultPrompt, repairJson } from '../src/core.js';

const LUA = 'function onStart(accessKey)\n  -- braces { } and quotes "day" and a backslash \\ and {"schemaVersion":2}\n  setChatVar(accessKey, "day", "1")\nend';
const block = (name, body) => `<<<${name}>>>\n${body}\n<<</${name}>>>`;
const luaDraft = () => { const c = blankCharacter(); c.triggerscript = [{ comment: '시작', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: 'function onStart(accessKey)\n  setChatVar(accessKey, "day", "1")\nend' }] }]; c.defaultVariables = 'day=1'; return c; };

test('a raw block carries code with quotes, newlines, braces and JSON-looking text without any escaping', () => {
  const c = luaDraft();
  const raw = JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '파트너 추가', changes: [{ task: 'lua', data: { scripts: [{ ref: null, comment: { block: 'c1' }, code: { block: 'lua1' } }], removeScripts: [], variables: { partner: { block: 'v1' } }, removeVariables: [] } }] } }) + '\n' + block('lua1', LUA) + '\n' + block('c1', '파트너 "슬롯"') + '\n' + block('v1', '없음');
  const packet = parseResponse(raw, 'workshop', c);
  assert.equal(packet.data.changes[0].data.scripts[0].code, LUA);
  assert.equal(packet.data.changes[0].data.scripts[0].comment, '파트너 "슬롯"');
  const next = applyPacket(c, packet);
  assert.equal(next.triggerscript[1].effect[0].code, LUA);
  assert.equal(next.defaultVariables, 'day=1\npartner=없음');
});

test('blocks work for text, edits before/after and lore content, may precede the JSON, and survive CRLF and headers', () => {
  const c = blankCharacter(); c.desc = '첫 줄 "인용"\n둘째 줄';
  const edits = { edits: [{ before: { block: 'b' }, after: { block: 'a' } }] };
  const raw = block('b', '첫 줄 "인용"') + '\n' + JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: edits } }) + '\n' + block('a', '첫 줄 "인용"\n새 줄 {with} braces');
  assert.equal(applyPacket(c, parseResponse(raw, 'description', c)).desc, '첫 줄 "인용"\n새 줄 {with} braces\n둘째 줄');
  const crlf = ('## OOC\r\n' + JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: { upsert: [{ ref: null, entry: { comment: 'A', key: 'a', content: { block: 'x' } } }], remove: [] } }) + '\r\n<<<x>>>\r\n내용 "그대로"\r\n둘째\r\n<<</x>>>\r\n끝.');
  const packet = parseResponse(crlf, 'lorebook', c);
  assert.equal(packet.data.upsert[0].entry.content, '내용 "그대로"\r\n둘째');
  const { text, blocks } = extractBlocks('앞\n<<<k>>>\n\n본문\n\n<<</k>>>\n뒤');
  assert.equal(text, '앞\n\n뒤'); assert.equal(blocks.get('k'), '\n본문\n');
  assert.deepEqual(applyBlocks({ a: [{ block: 'k' }], b: 1 }, blocks), { a: ['\n본문\n'], b: 1 });
});

test('block errors: unclosed is truncation; unknown reference, unreferenced block, duplicate and bad names are rejected', () => {
  const c = blankCharacter();
  const env = data => JSON.stringify({ schemaVersion: 2, task: 'description', data });
  assert.throws(() => parseResponse(env({ text: { block: 'x' } }) + '\n<<<x>>>\n잘림', 'description', c), e => e instanceof TruncatedResponseError && /<<<x>>>이 닫히지 않았습니다/.test(e.message));
  assert.throws(() => parseResponse(env({ text: { block: 'nope' } }) + '\n' + block('x', 'a'), 'description', c), /참조한 블록이 응답에 없습니다: <<<nope>>>/);
  assert.throws(() => parseResponse(env({ text: 'plain' }) + '\n' + block('x', 'a'), 'description', c), /JSON이 참조하지 않는 블록이 있습니다: <<<x>>>/);
  assert.throws(() => parseResponse(env({ text: { block: 'x' } }) + '\n' + block('x', 'a') + '\n' + block('x', 'b'), 'description', c), /블록 이름이 중복됩니다/);
  assert.throws(() => parseResponse(env({ text: { block: 'bad name' } }) + '\n' + block('bad name', 'a'), 'description', c), /블록 이름은 영문·숫자·_/);
  assert.throws(() => parseResponse(env({ text: { block: 'x' } }), 'description', c), e => e instanceof TruncatedResponseError && /참조한 블록이 응답에 없습니다: <<<x>>>/.test(e.message), 'JSON closed but its block never arrived: truncation');
});

test('a syntactically broken answer reports the position and surrounding text and is marked as a syntax error', () => {
  const c = blankCharacter();
  const unescaped = '{"schemaVersion":2,"task":"description","data":{"text":"say "hi" now"}}';
  const error = (() => { try { parseResponse(unescaped, 'description', c); } catch (e) { return e; } })();
  assert.ok(error instanceof JsonSyntaxError && error.syntax === true);
  assert.match(error.message, /JSON 문법이 깨졌습니다/); assert.match(error.message, /부근|위치 불명/); assert.match(error.message, /<<<이름>>> 블록/);
  assert.ok(error.detail.length > 0);
  assert.throws(() => parseResponse('앞 설명 {"schemaVersion":2,"task":"description","data":{"text":"x",}} 뒤', 'description', c), /JSON 문법이 깨졌습니다/);
  assert.throws(() => parseResponse('설명만 있고 JSON은 없습니다.', 'description', c), /완성된 JSON 응답 객체를 찾지 못했습니다/);
  assert.throws(() => parseResponse('{"schemaVersion":2,"task":"description","data":{"text":"unfinished', 'description', c), /응답이 중간에 끊겼습니다/);
});

test('the output contract explains raw blocks with an example and no longer demands a closing brace as the last character', () => {
  for (const task of ['lua', 'description', 'workshop']) {
    const text = composeMessages(newSession(), task, '요청', defaultPrompt(task)).map(m => m.content).join('\n');
    assert.match(text, /\[원문 블록 — 기본 규칙\]/); assert.match(text, /\{"block":"이름"\}/); assert.match(text, /<<<lua1>>>\nfunction onStart/);
    assert.doesNotMatch(text, /마지막 문자는 \}여야 한다/);
  }
});

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
const userText = options => options.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
async function make(handlers) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const store = new Map(), calls = [];
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => store.delete(k) }, registerSetting: async () => {}, registerButton: async () => ({}), onUnload: async () => {}, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); const handler = handlers[calls.length - 1]; assert.ok(handler, 'unexpected model call #' + calls.length); const out = await handler(options, app); return typeof out === 'string' ? { type: 'success', result: out } : out; } };
  const app = new Workshop(api, dom.window.document); await app.init();
  app.confirmRetry = async () => true; // tests exercise the retry itself; the dialog is covered separately
  app.task = 'description'; app.s.draft.desc = '서론.'; app.s.requests.description = '설명을 써 줘'; app.touch();
  return { app, dom, calls, close: () => { app.destroy(); dom.window.close(); } };
}

test('a broken-JSON answer is retried once with the position in the instruction; a second failure is reported', async () => {
  const broken = '{"schemaVersion":2,"task":"description","data":{"text":"say "hi" now"}}';
  const x = await make([
    () => broken,
    options => { const text = userText(options); assert.match(text, /\[주의\] 직전 응답의 JSON 문법이 깨졌다\(/); assert.match(text, /<<<이름>>> 블록/); return JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: { block: 't' } } }) + '\n' + block('t', '완성된 "설명"\n둘째 줄'); },
  ]);
  try {
    await x.app.sendRequest(); await wait();
    assert.equal(x.calls.length, 2); assert.equal(x.app.s.candidates.length, 1);
    assert.match(x.app.s.thread.at(-1).content, /JSON 문법이 깨져 한 번 다시 요청/);
    assert.equal(x.app.s.thread.at(-1).error, undefined);
    await x.app.applyCandidate(x.app.s.candidates[0]); assert.equal(x.app.s.draft.desc, '완성된 "설명"\n둘째 줄');
  } finally { x.close(); }
  const y = await make([() => broken, () => broken + ',']);
  try {
    await y.app.sendRequest(); await wait();
    assert.equal(y.calls.length, 2); assert.equal(y.app.s.candidates.length, 0);
    assert.equal(y.app.s.thread.at(-1).error, true); assert.match(y.app.s.thread.at(-1).content, /JSON 문법이 깨졌습니다/);
  } finally { y.close(); }
});

test('a response that ends right after a block while the JSON still references another block is classified as truncation', () => {
  const c = blankCharacter(); c.globalLore = [{ key: 'k', content: 'old', comment: 'rules' }];
  const env = JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: { upsert: [{ ref: 'l0', entry: { content: { block: 'lore_after_1' } } }, { ref: null, entry: { comment: '새', key: 'a', content: { block: 'lore_after_2' } } }], remove: [] } });
  const cut = env + '\n' + block('lore_after_1', '첫 구간 본문') + '\n';
  assert.throws(() => parseResponse(cut, 'lorebook', c), (error) => error instanceof TruncatedResponseError && /참조한 블록이 오기 전에 응답이 끝났습니다\. 참조한 블록이 응답에 없습니다: <<<lore_after_2>>>/.test(error.message));
  const trailing = cut + '\n설명이 더 이어집니다. 블록은 없습니다.';
  assert.throws(() => parseResponse(trailing, 'lorebook', c), (error) => !(error instanceof TruncatedResponseError) && /참조한 블록이 응답에 없습니다/.test(error.message));
});

test('a string that is exactly the block tag is accepted as a reference; a bare name is not; reference mistakes are retried once', async () => {
  const c = blankCharacter(); c.customscript = [{ comment: '규칙', in: 'a', out: 'old out', type: 'editdisplay', flag: 'g', ableFlag: true }];
  const env = JSON.stringify({ schemaVersion: 2, task: 'regex', data: { upsert: [{ ref: 'r0', rule: { out: { edits: [{ before: '<<<r0_before>>>', after: ' <<<r0_after>>> ' }] } } }], remove: [] } });
  const raw = env + '\n' + block('r0_before', 'old out') + '\n' + block('r0_after', 'new out');
  const packet = parseResponse(raw, 'regex', c);
  assert.equal(applyPacket(c, packet).customscript[0].out, 'new out');
  const bare = JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: 'x' } }) + '\n' + block('x', 'body');
  assert.throws(() => parseResponse(bare, 'description', c), e => e.blocks === true && /JSON이 참조하지 않는 블록이 있습니다: <<<x>>>. 블록을 쓸 자리에는 \{"block":"이름"\} 객체/.test(e.message));
  const x = await make([
    () => bare,
    options => { const text = userText(options); assert.match(text, /\[주의\] 직전 응답의 블록 참조가 잘못됐다\(/); assert.match(text, /\{"block":"이름"\} 객체/); return JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: { block: 'x' } } }) + '\n' + block('x', '완성 본문'); }
  ]);
  try {
    await x.app.sendRequest(); await wait();
    assert.equal(x.calls.length, 2); assert.equal(x.app.s.candidates.length, 1);
    assert.match(x.app.s.thread.at(-1).content, /블록 참조 형식이 잘못돼 한 번 다시 요청/);
    await x.app.applyCandidate(x.app.s.candidates[0]); assert.equal(x.app.s.draft.desc, '완성 본문');
  } finally { x.close(); }
});

test('when the envelope itself does not parse, inner task/data objects are not mistaken for the answer', async () => {
  const c = blankCharacter();
  // An unescaped quote inside a string: not one of the two mechanical slips the repair step removes.
  const broken = '{"schemaVersion":2,"task":"workshop","data":{"reply":"진행 "절차" 안내","changes":[{"task":"description","data":{"text":"x"}}]}}';
  const err = (() => { try { parseResponse(broken, 'workshop', c); } catch (e) { return e; } })();
  assert.ok(err instanceof JsonSyntaxError, 'syntax error, not 필수 필드 누락: ' + err.message);
  assert.doesNotMatch(err.message, /필수 필드 누락/);
  const x = await make([
    () => broken,
    options => { assert.match(userText(options), /JSON 문법이 깨졌다/); return JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '진행 절차', changes: [] } }); }
  ]);
  try {
    x.app.task = 'workshop'; x.app.s.requests.workshop = '진행 절차를 정리해 줘';
    await x.app.sendRequest(); await wait();
    assert.equal(x.calls.length, 2); assert.match(x.app.s.thread.at(-1).content, /진행 절차/); assert.equal(x.app.s.thread.at(-1).error, undefined);
  } finally { x.close(); }
  assert.throws(() => parseResponse(JSON.stringify({ task: 'description', data: { text: 'x' } }), 'description', c), /필수 필드 누락: schemaVersion/, 'a real envelope without schemaVersion still says so');
});

test('an automatic re-request first asks the user, showing the cause and the added instruction; declining stops with the original error', async () => {
  const broken = '{"schemaVersion":2,"task":"description","data":{"text":"say "hi" now"}}';
  const x = await make([() => broken, () => JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: '완성' } })]);
  try {
    let seen = null;
    x.app.confirmRetry = async (purpose, error, hint) => { seen = { purpose, message: error.message, hint }; return false; };
    await x.app.sendRequest(); await wait();
    assert.equal(x.calls.length, 1, 'declining must not send a second request');
    assert.match(seen.purpose, /JSON 문법이 깨졌습니다/); assert.match(seen.message, /JSON 문법이 깨졌습니다/); assert.match(seen.hint, /\[주의\] 직전 응답의 JSON 문법이 깨졌다/);
    assert.equal(x.app.s.thread.at(-1).error, true); assert.match(x.app.s.thread.at(-1).content, /재요청하지 않았습니다/);
    assert.equal(x.app.s.candidates.length, 0); assert.equal(x.app.job, null);
    // The real dialog: open it, check its content, choose "다시 요청".
    const p = x.app.confirmRetry = undefined, real = Object.getPrototypeOf(x.app).confirmRetry.bind(x.app);
    const pending = real('응답의 JSON 문법이 깨졌습니다', new Error('원인 문구'), '[주의] 지시');
    await wait();
    const doc = x.dom.window.document, modal = doc.querySelector('.modal');
    assert.match(modal.textContent, /LLM에 다시 요청할까요\?/); assert.match(modal.textContent, /실패 원인/); assert.match(modal.textContent, /원인 문구/); assert.match(modal.textContent, /\[주의\] 지시/); assert.match(modal.textContent, /입력 토큰이 한 번 더/);
    [...modal.querySelectorAll('button')].find(b => b.textContent === '다시 요청').click();
    assert.equal(await pending, true);
  } finally { x.close(); }
});

test('one stray closing brace or a trailing comma is removed, reported, and needs no re-request; other syntax errors still fail', async () => {
  const c = blankCharacter(); c.customscript = [{ comment: '규칙', in: 'a', out: 'old out', type: 'editdisplay', flag: 'g', ableFlag: true }];
  // The exact shape the user hit: an extra "}" before "]" closing the edits array.
  const stray = '{"schemaVersion":2,"task":"regex","data":{"upsert":[{"ref":"r0","rule":{"out":{"edits":[{"before":{"block":"out_before"},"after":{"block":"out_after"}}}]}}}],"remove":[]}}\n\n' + block('out_before', 'old out') + '\n' + block('out_after', 'new out');
  const packet = parseResponse(stray, 'regex', c);
  assert.deepEqual(packet.repairs, ["여분 닫는 괄호 '}' 1개 제거(151자 부근)"]);
  assert.equal(applyPacket(c, packet).customscript[0].out, 'new out');
  const trailing = '{"schemaVersion":2,"task":"description","data":{"text":"본문",},}';
  const fixed = parseResponse(trailing, 'description', c);
  assert.deepEqual(fixed.repairs, ['후행 쉼표 2개 제거']); assert.equal(fixed.data.text, '본문');
  assert.equal(repairJson('{"a":[{"b":1}}]}').text, '{"a":[{"b":1}]}');
  assert.equal(repairJson('{"a":"x, }"}').fixes.length, 0, 'commas inside strings are untouched');
  assert.equal(repairJson('{"schemaVersion":2,"task":"description","data":{"text":"say "hi" now"}}'), null, 'an unescaped quote is not repaired');
  assert.throws(() => parseResponse('{"schemaVersion":2,"task":"description","data":{"text":"say "hi" now"}}', 'description', c), e => e instanceof JsonSyntaxError);
  const x = await make([() => trailing]);
  try {
    let asked = false; x.app.confirmRetry = async () => { asked = true; return true; };
    await x.app.sendRequest(); await wait();
    assert.equal(x.calls.length, 1); assert.equal(asked, false, 'a repaired answer needs no re-request');
    assert.equal(x.app.s.candidates.length, 1); assert.match(x.app.s.thread.at(-1).content, /후행 쉼표 2개 제거.*그대로 읽었습니다/);
    assert.equal(x.app.s.candidates[0].packet.repairs, undefined, 'the note is not stored in the proposal');
  } finally { x.close(); }
});

test('a closing block tag glued to the last line, indented, or spaced inside is still a close; a missing one is truncation', () => {
  const c = luaDraft();
  const env = JSON.stringify({ schemaVersion: 2, task: 'lua', data: { scripts: [{ ref: null, comment: '새 Lua', code: { block: 'b_lua1' } }], removeScripts: [], variables: {}, removeVariables: [] } });
  const code = 'function onStart(accessKey)\n  setChatVar(accessKey, "day", "1")\nend';
  for (const tail of ['\n<<<b_lua1>>>\n' + code + '<<</b_lua1>>>', '\n  <<<b_lua1>>>\n' + code + '\n   <<</b_lua1>>>  ', '\n<<< b_lua1 >>>\n' + code + '\n<<< /b_lua1 >>>\n설명 끝', '\n<<<b_lua1>>>\n' + code + '  \n<<</b_lua1>>>']) {
    const packet = parseResponse(env + tail, 'lua', c);
    assert.equal(packet.data.scripts[0].code, code, JSON.stringify(tail));
  }
  const cut = env + '\n<<<b_lua1>>>\nfunction onStart(accessKey)\n  setChatVar(';
  assert.throws(() => parseResponse(cut, 'lua', c), e => e instanceof TruncatedResponseError && /<<<\/b_lua1>>>를 찾지 못함/.test(e.message) && /자 수신/.test(e.message));
});

test('opening block tag glued right after JSON closing brace and fenced JSON with trailing comma/extra brace are accepted', () => {
  const c = blankCharacter();
  const glued = JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: { block: 't1' } } }) + '<<<t1>>>\n본문\n<<</t1>>>';
  assert.equal(parseResponse(glued, 'description', c).data.text, '본문');
  const fencedTrailing = '```json\n{"schemaVersion":2,"task":"description","data":{"text":"본문",}}\n```';
  const fixed = parseResponse(fencedTrailing, 'description', c);
  assert.equal(fixed.data.text, '본문'); assert.deepEqual(fixed.repairs, ['후행 쉼표 1개 제거']);
  // Extra closer at root end and mismatched bracket inside object are fixed without relying on V8 error wording.
  assert.equal(repairJson('{"a":1}}').text, '{"a":1}');
  assert.equal(repairJson('{"a":1]}').text, '{"a":1}');
});

test('repairJson strips JS comments outside strings, escapes raw control chars and invalid backslashes, and preserves string URLs/valid escapes', () => {
  const c = blankCharacter();
  const commented = '{\n  // "메모 {\n  "schemaVersion": 2, /* 블록 주석 */\n  "task": "description",\n  "data": { "text": "https://example.com /* 유지 */\\n줄2" }\n} // 끝 주석 {';
  const parsedComments = parseResponse(commented, 'description', c);
  assert.equal(parsedComments.data.text, 'https://example.com /* 유지 */\n줄2');
  assert.deepEqual(parsedComments.repairs, ['주석 3개 제거']);

  const rawControls = '{"schemaVersion":2,"task":"description","data":{"text":"첫 줄\n둘째 줄\t탭"}}';
  const parsedControls = parseResponse(rawControls, 'description', c);
  assert.equal(parsedControls.data.text, '첫 줄\n둘째 줄\t탭');
  assert.deepEqual(parsedControls.repairs, ['문자열 안 제어문자 2개 이스케이프']);

  const badEscapes = String.raw`{"schemaVersion":2,"task":"regex","data":{"upsert":[{"ref":null,"rule":{"comment":"패턴","in":"\d+\s+\'a\'\u12\\d\uAC00","out":"$1","type":"editdisplay","flag":"g","ableFlag":true}}],"remove":[]}}`;
  const parsedEscapes = parseResponse(badEscapes, 'regex', c);
  assert.equal(parsedEscapes.data.upsert[0].rule.in, String.raw`\d+\s+\'a\'\u12\d` + '가');
  assert.deepEqual(parsedEscapes.repairs, ['비표준 역슬래시 5개 보정']);

  // Backslash right before a raw newline escapes both without corrupting the string.
  const slashNewline = '{"schemaVersion":2,"task":"description","data":{"text":"a\\\nb"}}';
  const parsedSlashNl = parseResponse(slashNewline, 'description', c);
  assert.equal(parsedSlashNl.data.text, 'a\\\nb');
  assert.deepEqual(parsedSlashNl.repairs, ['문자열 안 제어문자 1개 이스케이프', '비표준 역슬래시 1개 보정']);

  // Unclosed block comment and genuinely truncated JSON remain rejected.
  assert.equal(repairJson('{"a":1} /* unclosed'), null);
  assert.throws(() => parseResponse('{"schemaVersion":2,"task":"description","data":{"text":"cut', 'description', c), e => e instanceof TruncatedResponseError);
  // Plain text without JSON is tagged with noJson for optional workshop UI confirmation.
  assert.throws(() => parseResponse('일반 문장만 있습니다.', 'workshop', c), e => e.noJson === true && /완성된 JSON 응답 객체를 찾지 못했습니다/.test(e.message));
});

test('parseResponse fills omitted empty collection defaults and lenient mode restores missing envelope fields while still rejecting wrong shapes', () => {
  const c = blankCharacter();
  // Omitted empty collections in standard envelope.
  const ws = parseResponse(JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '대화만 합니다.' } }), 'workshop', c);
  assert.deepEqual(ws.data, { reply: '대화만 합니다.', changes: [] });
  assert.deepEqual(ws.repairs, ['누락된 changes([]) 보완']);

  const wsNested = parseResponse(JSON.stringify({
    schemaVersion: 2, task: 'workshop',
    data: { reply: '로어북 추가', changes: [{ task: 'lorebook', data: { upsert: [{ ref: null, entry: { key: 'k', content: 'v' } }] } }] }
  }), 'workshop', c);
  assert.deepEqual(wsNested.data.changes[0].data.remove, []);
  assert.deepEqual(wsNested.repairs, ['누락된 빈 목록(remove) 보완']);

  const lua = parseResponse(JSON.stringify({ schemaVersion: 2, task: 'lua', data: { scripts: [{ ref: null, comment: 'S', code: 'return 1' }] } }), 'lua', c);
  assert.deepEqual(lua.data.removeScripts, []); assert.deepEqual(lua.data.variables, {}); assert.deepEqual(lua.data.removeVariables, []);
  assert.match(lua.repairs[0], /누락된 Lua 빈 필드/);

  const choice = parseResponse(JSON.stringify({
    schemaVersion: 2, task: 'choiceGreeting',
    data: {
      text: '<button risu-btn="start_a">A 선택</button>',
      choices: [{ id: 'start_a', label: 'A 선택', content: '장면 A 본문' }],
      scripts: [{ ref: null, comment: 'S', code: 'function onButtonClick(accessKey, data)\n  if data == "start_a" then setChat(accessKey, 0, "장면 A 본문") end\nend' }]
    }
  }), 'choiceGreeting', c);
  assert.deepEqual(choice.data.variables, {}); assert.deepEqual(choice.data.regex, []);
  assert.match(choice.repairs[0], /누락된 시작 상황 빈 필드/);

  // Empty data object with no real keys is still rejected.
  assert.throws(() => parseResponse(JSON.stringify({ schemaVersion: 2, task: 'lorebook', data: {} }), 'lorebook', c), /필수 필드 누락: upsert/);

  // Lenient mode restores missing schemaVersion and bare task data (with plan, blocks, and mechanical repair).
  const noVer = parseResponse(JSON.stringify({ task: 'description', data: { text: '본문' } }), 'description', c, false, { lenient: true });
  assert.equal(noVer.schemaVersion, 2); assert.equal(noVer.data.text, '본문');
  assert.deepEqual(noVer.repairs, ['누락된 schemaVersion(2) 보완']);

  const bareCombined = '```json\n{\n  // bare lorebook\n  "upsert": [{ "ref": null, "entry": { "key": "k", "content": { "block": "b1" } } }],\n  "plan": [{ "title": "2부", "instruction": "나머지" }],\n}\n```\n' + block('b1', '블록 본문');
  const parsedBare = parseResponse(bareCombined, 'lorebook', c, false, { salvage: true });
  assert.equal(parsedBare.schemaVersion, 2); assert.equal(parsedBare.task, 'lorebook');
  assert.equal(parsedBare.data.upsert[0].entry.content, '블록 본문'); assert.deepEqual(parsedBare.data.remove, []);
  assert.equal(parsedBare.plan.length, 1);
  assert.deepEqual(parsedBare.repairs, ['주석 1개 제거', '후행 쉼표 1개 제거', '누락된 응답 봉투(schemaVersion·task·data) 복원', '누락된 빈 목록(remove) 보완']);

  // Arrays, nested wrappers, and mismatched tasks remain rejected even in lenient mode.
  assert.throws(() => parseResponse(JSON.stringify([{ text: 'x' }]), 'description', c, false, { lenient: true }));
  assert.throws(() => parseResponse(JSON.stringify({ wrapper: { text: 'x' } }), 'description', c, false, { lenient: true }));
  assert.throws(() => parseResponse(JSON.stringify({ task: 'greeting', data: { text: 'x' } }), 'description', c, false, { lenient: true }), /필수 필드 누락: schemaVersion/);
  assert.throws(() => parseResponse(JSON.stringify({ schemaVersion: 2, task: 'greeting', data: { text: 'x' } }), 'description', c, false, { lenient: true }), /작업 종류/);
});

test('v1.2.4 regressions: no regex lookbehind, \\b/\\f repair guard, prose bare-object rejection, and {{user}} noJson detection', async () => {
  const { readFileSync } = await import('node:fs');
  const coreSrc = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(coreSrc, /\(\?<[=!]/, 'src/core.js must not use regex lookbehind literals (Safari < 16.4)');

  const c = blankCharacter();
  // Glued opening tag after "}" works with spaces and in lenient unclosed-block salvage without losing "}".
  const gluedSpaced = JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: { block: 't1' } } }) + '  <<<t1>>>\n본문\n<<</t1>>>';
  assert.equal(parseResponse(gluedSpaced, 'description', c).data.text, '본문');
  const gluedUnclosed = extractBlocks('{"schemaVersion":2}<<<t1>>>\n잘림', { lenient: true });
  assert.equal(gluedUnclosed.text, '{"schemaVersion":2}');
  assert.equal(gluedUnclosed.unclosed, 't1');

  // \b or \f alongside non-standard escapes (e.g. unescaped regex "\bHP: (\d+)\b") is declined instead of turning \b into U+0008.
  const regexWithWordBoundary = String.raw`{"schemaVersion":2,"task":"regex","data":{"upsert":[{"ref":null,"rule":{"comment":"체력","in":"\bHP: (\d+)\b","out":"$1","type":"editdisplay","flag":"g","ableFlag":true}}],"remove":[]}}`;
  assert.equal(repairJson(regexWithWordBoundary), null);
  assert.throws(() => parseResponse(regexWithWordBoundary, 'regex', c, false, { salvage: true }), e => e instanceof JsonSyntaxError);

  const regexWithFormFeed = String.raw`{"schemaVersion":2,"task":"regex","data":{"upsert":[{"ref":null,"rule":{"comment":"줄","in":"\f(\d+)","out":"$1","type":"editdisplay","flag":"g","ableFlag":true}}],"remove":[]}}`;
  assert.equal(repairJson(regexWithFormFeed), null);
  assert.throws(() => parseResponse(regexWithFormFeed, 'regex', c, false, { salvage: true }), e => e instanceof JsonSyntaxError);

  // Properly escaped \\b alongside a single \d still repairs safely to \b...\d.
  const escapedBoundary = String.raw`{"schemaVersion":2,"task":"regex","data":{"upsert":[{"ref":null,"rule":{"comment":"체력","in":"\\bHP: (\d+)\\b","out":"$1","type":"editdisplay","flag":"g","ableFlag":true}}],"remove":[]}}`;
  const repairedBoundary = parseResponse(escapedBoundary, 'regex', c, false, { salvage: true });
  assert.equal(repairedBoundary.data.upsert[0].rule.in, String.raw`\bHP: (\d+)\b`);

  // Inline example objects inside prose must never be promoted to bare envelopes.
  assert.throws(() => parseResponse('형식 예: {"text":"예시"}처럼 보내면 됩니다.', 'description', c, false, { salvage: true }), e => e.noJson === true);
  assert.throws(() => parseResponse('대화 예시는 {"reply":"예시"} 형태입니다.', 'workshop', c, false, { salvage: true }), e => e.noJson === true);

  // Whole-response bare JSON and single-fenced bare JSON still restore in lenient/salvage mode.
  const wholeBare = parseResponse('{"text":"단독 본문"}', 'description', c, false, { salvage: true });
  assert.equal(wholeBare.data.text, '단독 본문');
  assert.deepEqual(wholeBare.repairs, ['누락된 응답 봉투(schemaVersion·task·data) 복원']);
  const fencedBare = parseResponse('```json\n{"text":"펜스 본문"}\n```', 'description', c, false, { salvage: true });
  assert.equal(fencedBare.data.text, '펜스 본문');
  assert.deepEqual(fencedBare.repairs, ['누락된 응답 봉투(schemaVersion·task·data) 복원']);

  // Plain prose mentioning {{user}}, {{char}}, or {{#if ...}} is classified as noJson (not JsonSyntaxError).
  assert.throws(
    () => parseResponse('좋아요! {{user}}와 {{char}}가 처음 만나는 장면을 먼저 정해볼까요?', 'workshop', c, false, { salvage: true }),
    e => e.noJson === true && !(e instanceof JsonSyntaxError)
  );
});


