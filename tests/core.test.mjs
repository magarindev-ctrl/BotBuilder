import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { blankCharacter, newSession, sessionFromCharacter, snapshot, restoreSnapshot, defaultPrompt, responseExamples, TASKS, composeMessages, parseResponse, applyPacket, mergeCharacter, saveExisting, callModel, regexTest, clone, editable } from '../src/core.js';
import { characterToCard, cardToCharacter, encodeModule, decodeModule, exportCharx, importCharx, unpack } from '../src/charx.js';
import { DEFAULT_INPUT_CHARS, MAX_INPUT_CHARS, PROMPT_BYTES_LIMIT, inputSize, migrateInputSettings, loreSelection, requestLorebook, validateLoreSelection, loreSelectionAfterPacket, reconcileLoreSelection } from '../src/core.js';

const envelope = (task, data) => JSON.stringify({ schemaVersion: 1, task, data });
const lore = (name, content = name) => ({ comment: name, key: name, secondkey: '', content, insertorder: 100, mode: 'normal', selective: false, alwaysActive: false });

test('large-request settings migrate legacy limits and preserve explicit current limits', () => {
  assert.equal(DEFAULT_INPUT_CHARS, 3000000);
  assert.equal(MAX_INPUT_CHARS, 10000000);
  assert.equal(migrateInputSettings({ maxInputChars: 100000 }).maxInputChars, DEFAULT_INPUT_CHARS);
  assert.equal(migrateInputSettings({ maxInputChars: 12000, inputLimitVersion: 2 }).maxInputChars, 12000);
  assert.equal(migrateInputSettings({ maxInputChars: -1 }).maxInputChars, DEFAULT_INPUT_CHARS);
  assert.equal(inputSize([{ content: 'a'.repeat(DEFAULT_INPUT_CHARS) }], DEFAULT_INPUT_CHARS).chars, DEFAULT_INPUT_CHARS);
  assert.throws(() => inputSize([{ content: 'a'.repeat(DEFAULT_INPUT_CHARS + 1) }], DEFAULT_INPUT_CHARS), /한도/);
  assert.throws(() => inputSize([{ content: 'a'.repeat(PROMPT_BYTES_LIMIT + 1) }], Infinity), /32MiB/);
});

test('selected lore is included once with stable refs and excluded proposal data stays out', () => {
  const s = newSession(); s.draft.globalLore = [lore('A', 'INCLUDED_BODY'), lore('B', 'EXCLUDED_BODY'), lore('C', 'THIRD_BODY')]; s.loreIncluded = [true, false, true];
  s.candidates = [{ id: 'pending', packet: { task: 'lorebook', data: { upsert: [{ ref: 'l1', entry: { content: 'EXCLUDED_PROPOSAL' } }], remove: [] } } }];
  assert.deepEqual(requestLorebook(s).map(x => x.ref), ['l0', 'l2']);
  for (const task of ['lorebook', 'workshop']) {
    const text = composeMessages(s, task, 'edit', defaultPrompt(task)).map(x => x.content).join('\n');
    assert.equal(text.split('INCLUDED_BODY').length - 1, 1);
    assert.doesNotMatch(text, /EXCLUDED_BODY|EXCLUDED_PROPOSAL/);
    assert.match(text, /THIRD_BODY/);
  }
  assert.equal(s.draft.globalLore.length, 3);
});

test('lore selections survive recovery, removal, insertion and host reorder', () => {
  const s = newSession(); s.draft.globalLore = [lore('A'), lore('B'), lore('C')]; s.loreIncluded = [true, false, true];
  assert.deepEqual(restoreSnapshot(snapshot(s)).loreIncluded, s.loreIncluded);
  const old = clone(s); delete old.loreIncluded;
  assert.deepEqual(restoreSnapshot(snapshot(old)).loreIncluded, [true, true, true]);
  assert.deepEqual(reconcileLoreSelection(s, [s.draft.globalLore[1], lore('new'), s.draft.globalLore[0]]), [false, true, true]);
  const packet = { task: 'lorebook', data: { upsert: [{ ref: null, entry: { key: 'new', content: 'new' } }], remove: ['l0'] } };
  assert.deepEqual(loreSelectionAfterPacket(s, packet), [false, true, true]);
  s.loreIncluded = loreSelectionAfterPacket(s, packet); s.draft = applyPacket(s.draft, packet);
  assert.deepEqual(loreSelection(s), [false, true, true]);
});

test('sparse lore response drops no-ops while preserving omitted entries and native settings', () => {
  const s = newSession(); s.draft.globalLore = [{ ...lore('A'), custom: 'keep', alwaysActive: true }, lore('B')];
  const packet = parseResponse(envelope('lorebook', { upsert: [{ ref: 'l0', entry: { comment: 'A', content: 'new' } }, { ref: 'l1', entry: { content: 'B' } }], remove: [] }), 'lorebook', s.draft);
  assert.deepEqual(packet.data.upsert, [{ ref: 'l0', entry: { content: 'new' } }]);
  const next = applyPacket(s.draft, packet);
  assert.equal(next.globalLore[0].custom, 'keep'); assert.equal(next.globalLore[0].alwaysActive, true);
  assert.deepEqual(next.globalLore[1], s.draft.globalLore[1]);
  s.loreIncluded = [false, true];
  assert.throws(() => validateLoreSelection(packet, s), /제외한 로어북/);
  assert.throws(() => validateLoreSelection({ task: 'workshop', data: { reply: '', changes: [packet] } }, s), /제외한 로어북/);
});

test('array or nested envelopes stay rejected with prose, fences and BOM', () => {
  const good = envelope('description', { text: 'keep {braces} and "quotes"' });
  for (const body of ['[' + good + ']', '[[' + good + ']]', '{"wrapper":' + good + '}']) {
    for (const wrapper of [x => x, x => 'OOC\n' + x + '\nend', x => '\uFEFF```json\n' + x + '\n```']) {
      assert.throws(() => parseResponse(wrapper(body), 'description', blankCharacter()));
    }
  }
  assert.equal(parseResponse('OOC\n' + good + '\nend', 'description', blankCharacter()).data.text, 'keep {braces} and "quotes"');
});
test('templates expand only once and include complete working context + conversation', () => {
  const s = newSession(); s.draft.desc = '<<USER_REQUEST>>'; s.thread.push({ role: 'assistant', content: 'earlier idea' });
  const messages = composeMessages(s, 'description', 'write it', defaultPrompt('description'));
  assert.equal(messages.length, 2); assert.match(messages[1].content, /<<USER_REQUEST>>/); assert.match(messages[1].content, /earlier idea/);
  assert.throws(() => composeMessages(s, 'description', 'x', { system: '', user: '<<USER_REQUEST>>' }), /누락/);
});
test('responses retain strict key, task, range and prototype validation after wrapper cleanup', () => {
  const c = blankCharacter();
  for (const raw of [envelope('greeting', { text: 'x' }), envelope('description', { text: 'x', chats: [{ id: 'c' }] }), '{"schemaVersion":1,"task":"description","data":{"text":"x","__proto__":{}}}']) assert.throws(() => parseResponse(raw, 'description', c));
  assert.throws(() => parseResponse(envelope('lorebook', { upsert: [{ ref: null, entry: { key: 'x', content: 'y', activationPercent: 101 } }], remove: [] }), 'lorebook', c));
});
test('task-specific output examples validate and distinguish dialogue from explicit manuscript changes',()=>{
  for(const task of Object.keys(TASKS)) {
    const examples=responseExamples(task);for(const example of examples)assert.deepEqual(parseResponse(JSON.stringify(example),task,blankCharacter()),example);
    const messages=composeMessages(newSession(),task,'이번 요청',defaultPrompt(task));
    assert.match(messages[1].content,/올바른 출력 예시/);assert.match(messages[1].content,/잘못된 출력 예시/);assert.match(messages[1].content,/## OOC Response/);
  }
  assert.deepEqual(responseExamples('workshop')[0].data.changes,[]);assert.equal(responseExamples('workshop')[1].data.changes[0].task,'description');
});
test('OOC headings, code fences, BOM and trailing explanations are removed around one valid response',()=>{
  const packet={schemaVersion:1,task:'workshop',data:{reply:"현재 이름은 '리아'로 설정되어 있습니다.\n\n1. 원하는 장르를 알려주세요.",changes:[]}},json=JSON.stringify(packet);
  for(const raw of ['## OOC Response\n'+json,'```json\n'+json+'\n```','\uFEFF설명입니다.\n```JSON\n'+json+'\n```\n완료했습니다.','{note}\n'+json+'\n{"usage":1}'])assert.deepEqual(parseResponse(raw,'workshop',blankCharacter()),packet);
});
test('wrapper cleanup preserves JSON string content including braces, escaped quotes and embedded code fences',()=>{
  const text=['## 제목','```lua','local t = { marker = "}" }','```','literal='+JSON.stringify('"[x]{y}"')].join('\n');
  const packet={schemaVersion:1,task:'description',data:{text}};
  assert.deepEqual(parseResponse('앞 설명 [OOC]\n```json\n'+JSON.stringify(packet)+'\n```\n뒷 설명','description',blankCharacter()),packet);
});
test('multiple response objects, arrays, nested envelopes and damaged JSON are never guessed or repaired',()=>{
  const good=envelope('description',{text:'x'});
  assert.throws(()=>parseResponse('prefix\n'+good+'\n'+good,'description',blankCharacter()),/여러 개/);
  for(const raw of ['```json\n['+good+']\n```','prefix {"wrapper":'+good+'}','prefix {"schemaVersion":1,"task":"description","data":{"text":"bad",}}','prefix {"schemaVersion":1,"task":"description","data":{"text":"unfinished}'])assert.throws(()=>parseResponse(raw,'description',blankCharacter()));
});
test('cleanup keeps size limits and does not discard schema errors from the candidate object',()=>{
  assert.throws(()=>parseResponse('x'.repeat(1048577)+envelope('description',{text:'x'}),'description',blankCharacter()),/1MiB/);
  assert.throws(()=>parseResponse('## OOC\n'+envelope('description',{text:'x',unknown:true})+'\nend','description',blankCharacter()),/허용하지 않는/);
  assert.throws(()=>parseResponse('## OOC\n'+envelope('greeting',{text:'x'}),'description',blankCharacter()),/작업 종류/);
});
test('proposal validation and apply preserve unrelated native fields', () => {
  const c = blankCharacter(); c.globalLore = [{ ...lore('one'), custom: 'keep', id: 'a' }, lore('two')]; c.chats[0].message.push({ data: 'conversation' });
  const packet = parseResponse(envelope('lorebook', { upsert: [{ ref: 'l0', entry: { content: 'new' } }], remove: [] }), 'lorebook', c);
  const after = applyPacket(c, packet);
  assert.equal(c.globalLore[0].content, 'one'); assert.equal(after.globalLore[0].content, 'new'); assert.equal(after.globalLore[0].custom, 'keep'); assert.deepEqual(after.chats, c.chats); assert.deepEqual(after.globalLore[1], c.globalLore[1]);
  assert.throws(() => parseResponse(envelope('lorebook', { upsert: [{ ref: 'l2', entry: { content: 'bad' } }], remove: [] }), 'lorebook', c));
});
test('Lua apply retains trigger conditions, other effects, variable names and untouched raw lines', () => {
  const c = blankCharacter(); c.defaultVariables = 'keep=1\nmodify=old\ninvalid line';
  c.triggerscript = [{ comment: 'old', type: 'input', conditions: [{ type: 'var', var: 'keep' }], effect: [{ type: 'triggerlua', code: 'old' }, { type: 'setvar', var: 'keep', value: '1' }], extra: true }];
  const packet = { task: 'lua', data: { scripts: [{ ref: 's0_0', comment: 'new', code: 'new' }], removeScripts: [], variables: { modify: 'new' }, removeVariables: [] } };
  const after = applyPacket(c, packet);
  assert.equal(after.triggerscript[0].effect[1].type, 'setvar'); assert.deepEqual(after.triggerscript[0].conditions, c.triggerscript[0].conditions); assert.match(after.defaultVariables, /invalid line/); assert.match(after.defaultVariables, /modify=new/); assert.equal(after.triggerscript[0].type, 'input');
});
test('bad multi-task changes fail without any partial mutation', () => {
  const c = blankCharacter(), original = clone(c);
  assert.throws(() => applyPacket(c, { task: 'workshop', data: { reply: 'x', changes: [{ task: 'description', data: { text: 'new' } }, { task: 'lua', data: { scripts: [], removeScripts: [], variables: { bad: 'a=b' }, removeVariables: [] } }] } }));
  assert.deepEqual(c, original);
});
test('choice bundle checks button/handler/content + existing handler conflicts', () => {
  const c = blankCharacter(), data = { text: '<button risu-btn="scene_a">A</button>opening scene', choices: [{ id: 'scene_a', label: 'A', content: 'opening scene' }], scripts: [{ ref: null, comment: 'choice', code: 'function onButtonClick(id,key) if key == "scene_a" then setChatVar(id,"scene","a") end end' }], variables: { scene: 'none' }, regex: [] };
  const after = applyPacket(c, { task: 'choiceGreeting', data }); assert.equal(after.triggerscript.length, 1); assert.equal(after.firstMessage, data.text);
  assert.throws(() => applyPacket(c, { task: 'choiceGreeting', data: { ...data, text: 'no button' } }));
  c.triggerscript = after.triggerscript; assert.throws(() => applyPacket(c, { task: 'choiceGreeting', data }), /충돌/);
});
test('three-way save preserves fresh chats and unedited fields, rejects same-field conflicts', () => {
  const c = blankCharacter(), base = editable(c), draft = clone(c), latest = clone(c);
  draft.desc = 'my edit'; latest.chats[0].message.push({ data: 'new chat' }); latest.personality = 'external'; latest.unknown = true;
  const result = mergeCharacter(base, draft, latest);
  assert.deepEqual(result.conflicts, []); assert.equal(result.merged.desc, 'my edit'); assert.equal(result.merged.personality, 'external'); assert.equal(result.merged.unknown, true); assert.equal(result.merged.chats[0].message.length, 1);
  latest.desc = 'other edit'; assert.deepEqual(mergeCharacter(base, draft, latest).conflicts, ['desc']);
});
test('item merge keeps external edits to a different lore item and external additions', () => {
  const c = blankCharacter(); c.globalLore = [{ ...lore('a'), id: 'a' }, { ...lore('b'), id: 'b' }];
  const d = clone(c), latest = clone(c); d.globalLore[0].content = 'mine'; latest.globalLore[1].content = 'theirs'; latest.globalLore.push(lore('third'));
  const r = mergeCharacter(editable(c), d, latest); assert.deepEqual(r.conflicts, []); assert.equal(r.merged.globalLore[0].content, 'mine'); assert.equal(r.merged.globalLore[1].content, 'theirs'); assert.equal(r.merged.globalLore.length, 3);
});
test('ambiguous duplicate arrays and external edits to a modified item conflict', () => {
  const c = blankCharacter(); c.globalLore = [lore('same'), lore('same')]; const d = clone(c), f = clone(c);
  d.globalLore[0].content = 'mine'; f.globalLore.push(lore('extra')); assert.ok(mergeCharacter(editable(c), d, f).conflicts.length);
  const x = blankCharacter(); x.globalLore = [{ ...lore('a'), id: 'a' }]; const y = clone(x), z = clone(x); y.globalLore[0].content = 'mine'; z.globalLore[0].content = 'theirs'; assert.ok(mergeCharacter(editable(x), y, z).conflicts.length);
});
test('indexed save resolves stable character ID after reorder and checks readback', async () => {
  const a = blankCharacter(), b = blankCharacter(), s = sessionFromCharacter(a); s.draft.desc = 'edited'; let items = [b, a], savedIndex;
  const api = { getDatabase: async () => ({ characters: items }), getCharacterFromIndex: async i => clone(items[i]), setCharacterToIndex: async (i, c) => { savedIndex = i; items[i] = clone(c); } };
  await saveExisting(api, s); assert.equal(savedIndex, 1); assert.equal(items[1].desc, 'edited'); assert.equal(items[0].desc, '');
});
test('snapshot excludes chats, keeps full draft state, candidates and unsaved prompt edits', () => {
  const s = newSession(); s.thread.push({ role: 'user', content: 'idea' }); s.candidates.push({ id: 'finished', status: 'applied' }); s.promptDrafts.workshop = { system: 'unsaved', user: 'draft' }; s.draft.chats[0].message.push({ data: 'private chat' });
  const value = snapshot(s), back = restoreSnapshot(JSON.stringify(value)); assert.equal(back.draft.chats, undefined); assert.deepEqual(back.thread, s.thread); assert.deepEqual(back.candidates, s.candidates); assert.equal(back.promptDrafts.workshop.system, 'unsaved'); assert.throws(() => restoreSnapshot({ schemaVersion: 2 }));
});
test('model mode, plugin-provider permission and successful response use one request', async () => {
  let calls = 0; const text = await callModel({ runLLMModel: async options => { calls++; assert.equal(options.mode, 'model'); assert.equal(options.allowPlugins, true); return { type: 'success', result: 'ok' }; } }, [], 'model', 1, {});
  assert.equal(text, 'ok'); assert.equal(calls, 1);
});
test('waiting can stop even if provider never resolves, with no automatic retry', async () => {
  let calls = 0; const job = {};
  const pending = callModel({ runLLMModel: () => { calls++; return new Promise(() => {}); } }, [], 'submodel', 1, job); await Promise.resolve(); job.stop(); await assert.rejects(pending, /중단/); assert.equal(calls, 1);
});
test('cumulative host stream is read as snapshots rather than concatenated', async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue({ 0: 'o' }); c.enqueue({ 0: 'ok' }); c.close(); } });
  const result = await callModel({ runLLMModel: async () => ({ type: 'streaming', result: stream }) }, [], 'submodel', 1, {}); assert.equal(result, 'ok');
});
test('regex text test captures, global/first, HTML-as-text and Risu replacement syntax', async () => {
  const rule = { in: '(cat)', out: '<b>$1</b>', ableFlag: true, flag: 'g' };
  const r = await regexTest(rule, 'cat cat'); assert.equal(r.matches.length, 2); assert.equal(r.output, '<b>cat</b>\n <b>cat</b>\n');
  assert.equal((await regexTest({ ...rule, flag: 'i', out: '$1:$n{{data}}' }, 'cat cat')).output, 'cat:\n{{data}} cat');
  assert.equal((await regexTest({ ...rule, in: '' }, 'cat')).output, 'cat');
});
test('regex rejects unsupported constructs, flags, over-limit input and obeys stop', async () => {
  for (const pattern of ['(a)\\1', 'a(?=b)']) await assert.rejects(regexTest({ in: pattern, out: '', ableFlag: true, flag: 'g' }, 'ab'), /미지원/);
  await assert.rejects(regexTest({ in: '.', out: '', ableFlag: true, flag: 'y' }, 'x'), /플래그/);
  await assert.rejects(regexTest({ in: '.', out: '', flag: 'g' }, 'x'.repeat(65537)), /65,536/);
  await assert.rejects(regexTest({ in: '.', out: '', flag: 'g' }, 'x', { cancelled: true }), /중단/);
});
test('regex zero-width matches terminate and match limit is clearly partial', async () => {
  const r = await regexTest({ in: '^|$', out: '-', ableFlag: true, flag: 'g' }, 'abc'); assert.equal(r.output, '-abc-');
  const limited = await regexTest({ in: '.', out: 'y', ableFlag: true, flag: 'g' }, 'x'.repeat(1001)); assert.equal(limited.limited, true); assert.equal(limited.matches.length, 1000);
});
test('charx module codec preserves native regex, Lua effects and lore extensions', () => {
  const c = blankCharacter(); c.globalLore = [{ ...lore('one'), extentions: { unknown: 42 } }]; c.customscript = [{ in: 'a', out: 'b', type: 'editdisplay', extra: true }]; c.triggerscript = [{ type: 'input', conditions: [], effect: [{ type: 'triggerlua', code: 'x' }, { type: 'setvar' }] }];
  const decoded = decodeModule(encodeModule(c)); assert.deepEqual(decoded.lorebook, c.globalLore); assert.deepEqual(decoded.regex, c.customscript); assert.deepEqual(decoded.trigger, c.triggerscript);
});
test('CCv3 conversion retains extension data and never grants imported low-level permissions', () => {
  const c = blankCharacter(); c.extentions = { thirdParty: { keep: true } }; c.defaultVariables = 'x=1'; c.lowLevelAccess = true;
  const card = characterToCard(c), round = cardToCharacter(card);
  assert.equal(round.extentions.thirdParty.keep, true); assert.equal(round.defaultVariables, 'x=1'); assert.equal(round.lowLevelAccess, false);
});
test('charx full roundtrip embeds referenced image bytes and preserves native Lua/lore', async () => {
  const c = blankCharacter(); c.globalLore = [lore('a')]; c.defaultVariables = 'scene=none'; c.triggerscript = [{ comment: 'x', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: '-- code' }] }]; c.additionalAssets = [['map', 'assets/source', 'png']];
  const buffer = await exportCharx({ readImage: async () => Uint8Array.from([1, 2, 3]) }, c); const { card, files } = unpack(buffer); assert.equal(card.data.assets[0].uri, 'embeded://assets/0.png'); assert.deepEqual([...files['assets/0.png']], [1, 2, 3]);
  let saves = 0; const imported = await importCharx({ saveAsset: async value => { saves++; assert.deepEqual([...value], [1, 2, 3]); return 'assets/imported'; } }, buffer);
  assert.equal(saves, 1); assert.equal(imported.character.additionalAssets[0][1], 'assets/imported'); assert.deepEqual(imported.character.triggerscript, c.triggerscript); assert.deepEqual(imported.character.globalLore, c.globalLore);
});

test('empty foreign fields such as "choices": [] are dropped instead of rejecting the whole proposal', () => {
  const draft = blankCharacter(); draft.globalLore = [{ key: 'k', content: 'old rule', comment: 'rules' }];
  const raw = JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '제안', changes: [{ task: 'lorebook', data: { upsert: [{ ref: null, entry: { comment: '새 항목', key: 'a', content: 'b' } }], remove: [], scripts: [] } }], choices: [], text: '', variables: {} } });
  const packet = parseResponse(raw, 'workshop', draft);
  assert.deepEqual(Object.keys(packet.data).sort(), ['changes', 'reply']);
  assert.deepEqual(Object.keys(packet.data.changes[0].data).sort(), ['remove', 'upsert']);
  assert.equal(applyPacket(draft, packet).globalLore.length, 2);
  const filled = JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '제안', changes: [], choices: [{ id: 'a', label: 'x', content: 'y' }] } });
  assert.throws(() => parseResponse(filled, 'workshop', draft), /허용하지 않는 필드: choices/);
  assert.throws(() => parseResponse(JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: 'ok', notes: 'extra' } }), 'description', draft), /허용하지 않는 필드: notes/);
});

test('a response cut off mid-stream is reported as truncated with the received length', () => {
  const draft = blankCharacter();
  const whole = JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: '아주 긴 본문 '.repeat(50) } });
  const cut = whole.slice(0, Math.floor(whole.length * 0.6));
  assert.throws(() => parseResponse(cut, 'description', draft), /응답이 중간에 끊겼습니다 · [\d,]+자 수신/);
  assert.throws(() => parseResponse('설명만 있고 JSON은 없습니다.', 'description', draft), /완성된 JSON 응답 객체를 찾지 못했습니다/);
  assert.equal(parseResponse('{"schemaVersion":2,"task":"description","data":{"text":"ok"}} 뒤에 {"열린', 'description', draft).data.text, 'ok', 'a complete object before trailing junk still wins');
  assert.equal(parseResponse(whole, 'description', draft).data.text, '아주 긴 본문 '.repeat(50));
});

test('default prompts carry the output-length rules', () => {
  const prompt = defaultPrompt('workshop');
  assert.match(prompt.system, /출력 길이 규칙/);
  assert.match(prompt.system, /edits 부분편집으로만/);
  assert.match(prompt.system, /긴 본문이 필요한 작업은 한 응답의 changes에 하나만/);
  assert.match(defaultPrompt('greeting').system, /출력 길이 규칙/);
});
