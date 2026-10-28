import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTextValue, textEditRanges, textEditPreview } from '../src/text-edits.js';
import { blankCharacter, newSession, clone, parseResponse, applyPacket, proposalDiff, validateLoreSelection, snapshot, restoreSnapshot, textEditExample, TASKS, composeMessages, defaultPrompt } from '../src/core.js';

const edit = (before, after) => ({ edits: [{ before, after }] });
const packet = (task, data) => ({ schemaVersion: 2, task, data });
function fixture() {
  const c = blankCharacter(); c.desc = '설명 시작\n온화한 안내인\n설명 끝'; c.firstMessage = '인사 시작\n문을 연다\n인사 끝';
  c.globalLore = [{ key: '항구', comment: '도시', content: '로어 시작\n등대가 있다\n로어 끝', alwaysActive: true, nativeExtra: 'keep' }, { key: '별', content: '그대로' }];
  c.customscript = [{ comment: '화면', in: 'score: (\\d+)', out: '.panel {\r\n  color: #fff;\r\n  padding: 12px;\r\n}', type: 'editdisplay', flag: 'g', ableFlag: true, nativeExtra: 'keep' }];
  c.triggerscript = [{ comment: 'Lua 이름', type: 'input', conditions: [{ type: 'var', var: 'score' }], effect: [{ type: 'triggerlua', code: 'local mood = "calm"\nlocal score = 0\nprint(mood)' }, { type: 'setvar', var: 'score', value: '1' }], nativeExtra: 'keep' }];
  c.defaultVariables = 'mood=calm\nscore=0\ninvalid preserved line'; return c;
}

test('all edits locate the immutable source, apply in source order and keep literal replacement characters', () => {
  const changes = { edits: [{ before: 'B', after: '$& $1 \\path' }, { before: 'A', after: 'B' }] };
  assert.equal(resolveTextValue('A / B / C', changes, 'test'), 'B / $& $1 \\path / C');
  assert.throws(() => resolveTextValue('A / B', { edits: [{ before: 'A', after: 'NEW' }, { before: 'NEW', after: 'X' }] }, 'test'), /일치하는 구간이 없/);
});

test('ambiguous, overlapping, absent and empty anchors fail instead of guessing', () => {
  for (const [source, changes, error] of [
    ['foo foo', edit('foo', 'bar'), /여러 곳/], ['aaa', edit('aa', 'b'), /여러 곳/],
    ['abc', edit('x', 'y'), /일치하는 구간이 없/], ['abc', edit('', 'y'), /비어 있지/],
    ['abcd', { edits: [{ before: 'abc', after: 'x' }, { before: 'bcd', after: 'y' }] }, /겹칩니다/],
    ['abc', { edits: [{ before: 'abc', after: 'x' }, { before: 'abc', after: 'y' }] }, /겹칩니다/]
  ]) assert.throws(() => resolveTextValue(source, changes, 'test'), error);
  assert.equal(resolveTextValue('abcd', { edits: [{ before: 'ab', after: 'A' }, { before: 'cd', after: 'C' }] }, 'test'), 'AC');
});

test('exact whitespace and CRLF are preserved; insertion and deletion use explicit anchors', () => {
  assert.throws(() => resolveTextValue('a\r\nb', edit('a\nb', 'x'), 'test'), /일치하는 구간이 없/);
  assert.equal(resolveTextValue('a\r\nb', edit('a\r\n', 'a\r\nnew\r\n'), 'test'), 'a\r\nnew\r\nb');
  assert.equal(resolveTextValue('start middle end', edit(' middle', ''), 'test'), 'start end');
});

test('edit payload has strict keys, types and a bounded edit count', () => {
  const invalid = [[], null, 1, { edits: [] }, { edits: [{ before: 'a', after: 1 }] }, { edits: [{ before: 'a', after: 'b', line: 1 }] }, { edits: [{ before: 'a', after: 'b' }], mode: 'replace' }, JSON.parse('{"edits":[{"before":"a","after":"b"}],"__proto__":{}}'), { edits: Array.from({ length: 101 }, () => ({ before: 'a', after: 'b' })) }];
  for (const value of invalid) assert.throws(() => resolveTextValue('a', value, 'test'));
  assert.throws(() => resolveTextValue(undefined, edit('a', 'b'), 'new', false), /새 항목/);
});

test('line previews track original and resulting line ranges without modifying the packet', () => {
  const source = 'one\r\ntwo\r\nthree\r\nfour';
  const changes = { edits: [{ before: 'four', after: 'FOUR' }, { before: 'two\r\n', after: 'TWO\r\ninserted\r\n' }] };
  const before = clone(changes), rows = textEditPreview(source, changes, 'code');
  assert.deepEqual(rows.map(r => [r.startLine, r.endLine, r.afterStartLine, r.afterEndLine]), [[2, 2, 2, 3], [4, 4, 5, 5]]);
  assert.deepEqual(changes, before); assert.equal(textEditRanges(source, changes).length, 2);
});

test('one workshop packet patches description, greeting, lore, regex, Lua and variables atomically', () => {
  const c = fixture(), before = clone(c);
  const p = packet('workshop', { reply: '수정안', changes: [
    { task: 'description', data: { text: edit('온화한', '신중한') } },
    { task: 'greeting', data: { text: edit('문을 연다', '창을 연다') } },
    { task: 'lorebook', data: { upsert: [{ ref: 'l0', entry: { content: edit('등대가 있다', '탑이 있다'), key: edit('항구', '도시') } }], remove: [] } },
    { task: 'regex', data: { upsert: [{ ref: 'r0', rule: { in: edit('score:', 'points:'), out: edit('  color: #fff;', '  color: #ddd;') } }], remove: [] } },
    { task: 'lua', data: { scripts: [{ ref: 's0_0', code: edit('local mood = "calm"', 'local mood = "curious"') }], removeScripts: [], variables: { mood: edit('calm', 'curious') }, removeVariables: [] } }
  ] });
  const parsed = parseResponse('OOC\n```json\n' + JSON.stringify(p) + '\n```\nend', 'workshop', c);
  assert.deepEqual(parsed, p); const next = applyPacket(c, parsed);
  assert.equal(next.desc, '설명 시작\n신중한 안내인\n설명 끝'); assert.match(next.firstMessage, /창을 연다/);
  assert.equal(next.globalLore[0].key, '도시'); assert.match(next.globalLore[0].content, /탑이 있다/);
  assert.equal(next.globalLore[0].nativeExtra, 'keep'); assert.deepEqual(next.globalLore[1], c.globalLore[1]);
  assert.equal(next.customscript[0].out, '.panel {\r\n  color: #ddd;\r\n  padding: 12px;\r\n}'); assert.equal(next.customscript[0].flag, 'g');
  assert.equal(next.triggerscript[0].comment, c.triggerscript[0].comment); assert.deepEqual(next.triggerscript[0].conditions, c.triggerscript[0].conditions); assert.deepEqual(next.triggerscript[0].effect[1], c.triggerscript[0].effect[1]);
  assert.match(next.triggerscript[0].effect[0].code, /curious/); assert.equal(next.defaultVariables, 'mood=curious\nscore=0\ninvalid preserved line');
  assert.deepEqual(c, before); const rows = proposalDiff(c, parsed);
  assert.equal(rows.length, 8); assert.ok(rows.every(r => r.mode === 'patch')); assert.ok(rows.every(r => r.startLine >= 1));
  assert.doesNotMatch(JSON.stringify(rows), /설명 끝|padding: 12px|print\(mood\)/);
});

test('a late invalid edit rejects the whole change bundle without mutating any target', () => {
  const c = fixture(), before = clone(c);
  const p = packet('workshop', { reply: 'x', changes: [{ task: 'description', data: { text: edit('온화한', '신중한') } }, { task: 'lua', data: { scripts: [{ ref: 's0_0', code: edit('missing', 'x') }], removeScripts: [], variables: {}, removeVariables: [] } }] });
  assert.throws(() => parseResponse(JSON.stringify(p), 'workshop', c), /일치하는 구간이 없/);
  assert.throws(() => applyPacket(c, p), /일치하는 구간이 없/); assert.deepEqual(c, before);
});

test('new entries require full strings while full replacement and mixed settings remain supported', () => {
  const c = fixture();
  assert.throws(() => applyPacket(c, packet('lorebook', { upsert: [{ ref: null, entry: { key: 'new', content: edit('old', 'new') } }], remove: [] })), /새 항목/);
  assert.throws(() => applyPacket(c, packet('lua', { scripts: [{ ref: null, code: 'new' }], removeScripts: [], variables: {}, removeVariables: [] })), /새 Lua/);
  assert.throws(() => applyPacket(c, packet('lua', { scripts: [], removeScripts: [], variables: { newvar: edit('a', 'b') }, removeVariables: [] })), /새 항목/);
  const next = applyPacket(c, packet('regex', { upsert: [{ ref: 'r0', rule: { out: edit('#fff', '#ddd'), type: 'editoutput', flag: 'gi' } }], remove: [] }));
  assert.equal(next.customscript[0].type, 'editoutput'); assert.equal(next.customscript[0].flag, 'gi');
  assert.equal(applyPacket(c, packet('description', { text: '명시적인 전체 재작성' })).desc, '명시적인 전체 재작성');
  assert.equal(applyPacket(blankCharacter(), packet('description', { text: '처음 작성' })).desc, '처음 작성');
});

test('references, excluded lore, duplicate edits/removals and variable constraints stay enforced', () => {
  const s = newSession(); s.draft = fixture(); s.loreIncluded = [false, true];
  const p = packet('lorebook', { upsert: [{ ref: 'l0', entry: { content: edit('등대', '탑') } }], remove: [] });
  assert.throws(() => validateLoreSelection(p, s), /제외한 로어북/);
  assert.throws(() => applyPacket(s.draft, packet('lorebook', { ...p.data, remove: ['l0'] })), /삭제 참조/);
  assert.throws(() => applyPacket(s.draft, packet('lorebook', { upsert: [{ ref: 'l99', entry: { content: edit('a', 'b') } }], remove: [] })), /참조/);
  assert.throws(() => applyPacket(s.draft, packet('lua', { scripts: [], removeScripts: [], variables: { mood: edit('calm', 'bad=value') }, removeVariables: [] })), /등호/);
  assert.throws(() => applyPacket(s.draft, packet('regex', { upsert: [{ ref: 'r0', rule: { type: edit('editdisplay', 'editoutput') } }], remove: [] })), /문자열/);
  s.draft.triggerscript[0].effect.push({ type: 'triggerlua', code: 'local other = 1' });
  const collision = packet('lua', { scripts: [{ ref: 's0_0', comment: edit('이름', '첫 이름') }, { ref: 's0_2', comment: edit('이름', '둘째 이름') }], removeScripts: [], variables: {}, removeVariables: [] });
  assert.throws(() => applyPacket(s.draft, collision), /중복 수정/);
});

test('Lua comment-only edits preserve code and code-only edits preserve metadata', () => {
  const c = fixture();
  const next = applyPacket(c, packet('lua', { scripts: [{ ref: 's0_0', comment: edit('이름', '제목') }], removeScripts: [], variables: {}, removeVariables: [] }));
  assert.equal(next.triggerscript[0].comment, 'Lua 제목'); assert.deepEqual(next.triggerscript[0].effect, c.triggerscript[0].effect);
  delete c.triggerscript[0].comment;
  const codeOnly = applyPacket(c, packet('lua', { scripts: [{ ref: 's0_0', code: edit('"calm"', '"curious"') }], removeScripts: [], variables: {}, removeVariables: [] }));
  assert.equal(Object.hasOwn(codeOnly.triggerscript[0], 'comment'), false);
});

test('legacy v1 responses and recovery stay valid; edits require v2 and remain compact in storage', () => {
  const s = newSession(); s.draft = fixture(); const p = packet('description', { text: edit('온화한', '신중한') });
  assert.equal(parseResponse('{"schemaVersion":1,"task":"description","data":{"text":"legacy"}}', 'description', s.draft).data.text, 'legacy');
  const legacyVariables = { schemaVersion: 1, task: 'lua', data: { scripts: [], removeScripts: [], variables: { edits: '1' }, removeVariables: [] } };
  assert.deepEqual(parseResponse(JSON.stringify(legacyVariables), 'lua', s.draft), legacyVariables);
  assert.throws(() => parseResponse(JSON.stringify({ ...p, schemaVersion: 1 }), 'description', s.draft), /schemaVersion: 2/);
  s.candidates = [{ before: clone(s.draft), packet: p }]; const restored = restoreSnapshot(snapshot(s));
  assert.deepEqual(restored.candidates[0].packet, p); assert.match(applyPacket(restored.draft, p).desc, /신중한/);
  const beforePrompt = composeMessages(s, 'workshop', '이 수정안 검토', defaultPrompt('workshop'))[1].content;
  assert.match(beforePrompt, /before/); assert.match(beforePrompt, /after/); assert.match(beforePrompt, /schemaVersion/);
});

test('patching choice bundles validates resolved button handlers and preserves other trigger effects', () => {
  const c = blankCharacter(), seed = clone(TASKS.choiceGreeting.format), first = applyPacket(c, packet('choiceGreeting', seed));
  const p = packet('choiceGreeting', { text: edit('선택한 장면', '수정한 장면'), choices: [{ ...seed.choices[0], content: '수정한 장면' }], scripts: [{ ref: 's0_0', code: edit('\nend', '\nend\n-- updated') }], variables: {}, regex: [] });
  const next = applyPacket(first, p); assert.match(next.firstMessage, /수정한 장면/); assert.match(next.triggerscript[0].effect[0].code, /updated/);
  const broken = clone(p); broken.data.scripts[0].code = edit('"scene_a"', '"scene_z"');
  assert.throws(() => applyPacket(first, broken), /Lua 분기/);
});

test('every task partial-edit example validates against its stated source', () => {
  for (const task of Object.keys(TASKS)) {
    const { source, packet: p } = textEditExample(task), c = blankCharacter();
    c.desc = source; c.firstMessage = source; c.globalLore = [{ key: 'example', content: source }]; c.customscript = [{ in: 'x', out: source, type: 'editdisplay' }];
    if (task === 'lua') c.triggerscript = [{ comment: 'example', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: source }] }];
    assert.deepEqual(parseResponse(JSON.stringify(p), task, c), p); assert.ok(proposalDiff(c, p).length);
  }
});

test('long CSS patches keep the response small and omit unchanged source from review', () => {
  const c = fixture(); c.customscript[0].out = '/* unchanged */\n'.repeat(20000) + '.unique { color: red; }\n';
  const p = packet('regex', { upsert: [{ ref: 'r0', rule: { out: edit('.unique { color: red; }', '.unique { color: blue; }') } }], remove: [] });
  assert.ok(JSON.stringify(p).length < 300); const next = applyPacket(c, p); assert.equal(next.customscript[0].out, c.customscript[0].out.replace('color: red', 'color: blue'));
  const rows = proposalDiff(c, p); assert.equal(rows[0].startLine, 20001); assert.ok(JSON.stringify(rows).length < 500);
});
