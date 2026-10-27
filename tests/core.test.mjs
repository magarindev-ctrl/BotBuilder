import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { blankCharacter, newSession, sessionFromCharacter, snapshot, restoreSnapshot, defaultPrompt, composeMessages, parseResponse, applyPacket, mergeCharacter, saveExisting, callModel, regexTest, clone, editable } from '../src/core.js';
import { characterToCard, cardToCharacter, encodeModule, decodeModule, exportCharx, importCharx, unpack } from '../src/charx.js';

const envelope = (task, data) => JSON.stringify({ schemaVersion: 1, task, data });
const lore = (name, content = name) => ({ comment: name, key: name, secondkey: '', content, insertorder: 100, mode: 'normal', selective: false, alwaysActive: false });
test('templates expand only once and include complete working context + conversation', () => {
  const s = newSession(); s.draft.desc = '<<USER_REQUEST>>'; s.thread.push({ role: 'assistant', content: 'earlier idea' });
  const messages = composeMessages(s, 'description', 'write it', defaultPrompt('description'));
  assert.equal(messages.length, 2); assert.match(messages[1].content, /<<USER_REQUEST>>/); assert.match(messages[1].content, /earlier idea/);
  assert.throws(() => composeMessages(s, 'description', 'x', { system: '', user: '<<USER_REQUEST>>' }), /누락/);
});
test('responses reject arbitrary keys, wrong task, code fences, invalid range, prototype keys', () => {
  const c = blankCharacter();
  for (const raw of ['```json\n' + envelope('description', { text: 'x' }) + '\n```', envelope('greeting', { text: 'x' }), envelope('description', { text: 'x', chats: [] }), '{"schemaVersion":1,"task":"description","data":{"text":"x","__proto__":{}}}']) assert.throws(() => parseResponse(raw, 'description', c));
  assert.throws(() => parseResponse(envelope('lorebook', { upsert: [{ ref: null, entry: { key: 'x', content: 'y', activationPercent: 101 } }], remove: [] }), 'lorebook', c));
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
