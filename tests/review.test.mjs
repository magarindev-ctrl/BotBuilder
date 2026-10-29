import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCandidates, reviewTextValue } from '../src/text-edits.js';
import { blankCharacter, clone, luaFirstTriggers, reviewPacket, parseResponse, applyPacket } from '../src/core.js';
import { encodeModule, decodeModule, characterToCard, cardToCharacter } from '../src/charx.js';
const edit = (before, after) => ({ edits: [{ before, after }] });

test('prose review offers exact duplicates, punctuation differences and similar sentences without auto-applying', async () => {
  assert.equal(reviewCandidates('same same','same').length,2);
  assert.equal(reviewCandidates('붉은 달이 떴다.','붉은달이떴다!')[0].kind,'공백·기호 차이');
  assert.ok(reviewCandidates('붉은 달이 하늘에 떴다.','붉은 달이 오늘 떴다.').length);
  let calls=0;
  assert.equal(await reviewTextValue('same same',edit('same','new'),'text',async ({candidates})=>{calls++;return {...candidates[1],after:'new'};}),'same new');
  assert.equal(calls,1);
  assert.equal(await reviewTextValue('same same',edit('same','new'),'text',async ()=>null),'same same');
});
test('review preserves exact patches and rejects malformed, out-of-range or overlapping selections', async () => {
  const value=edit('one','two');
  assert.equal(await reviewTextValue('one',value,'text',()=>assert.fail('unnecessary review')),value);
  await assert.rejects(reviewTextValue('one',edit('','x'),'text',()=>null),/형식/);
  await assert.rejects(reviewTextValue('one',edit('other','x'),'text',()=>({start:-1,end:1,after:'x'})),/구간/);
  await assert.rejects(reviewTextValue('abcdef',{edits:[{before:'abc',after:'x'},{before:'bcd',after:'y'}]},'text',()=>null),/겹/);
});
test('packet review allows manual prose selection but keeps Lua and regex edits exact-only', async () => {
  const c=blankCharacter();c.desc='original';c.globalLore=[{content:'original',comment:'title',key:'key'}];
  let calls=0;const choose=async ()=>{calls++;return {start:0,end:8,after:'manual'};};
  const packet={schemaVersion:2,task:'description',data:{text:edit('wrong','unused')}};
  const result=await reviewPacket(parseResponse(JSON.stringify(packet),'description',c,true),c,choose);
  assert.equal(applyPacket(c,result).desc,'manual');assert.equal(c.desc,'original');assert.equal(calls,1);
  c.customscript=[{comment:'r',in:'abc',out:'original',type:'editoutput'}];
  await assert.rejects(reviewPacket({schemaVersion:2,task:'regex',data:{upsert:[{ref:'r0',rule:{out:edit('wrong','x')}}],remove:[]}},c,choose),/일치하는 구간이 없/);
  c.triggerscript=[{comment:'lua',type:'start',conditions:[],effect:[{type:'triggerlua',code:'print(1)'}]}];
  await assert.rejects(reviewPacket({schemaVersion:2,task:'lua',data:{scripts:[{ref:'s0_0',code:edit('wrong','x')}],removeScripts:[],variables:{},removeVariables:[]}},c,choose),/일치하는 구간이 없/);
  assert.equal(calls,1);
});
test('Lua-first ordering preserves separate scripts and other triggers through charx module serialization', () => {
  const triggers=[{comment:'v2',type:'start',conditions:[],effect:[{type:'v2Header'}]},...[1,2].map(n=>({comment:'lua'+n,type:'start',conditions:[],effect:[{type:'triggerlua',code:'local x = '+n}]}))];
  const before=clone(triggers), ordered=luaFirstTriggers(triggers);
  assert.deepEqual(ordered,[triggers[1],triggers[0],triggers[2]]);assert.deepEqual(triggers,before);
  const c=blankCharacter();c.triggerscript=triggers;
  const module=decodeModule(encodeModule(c));assert.deepEqual(module.trigger,ordered);
  assert.deepEqual(cardToCharacter(characterToCard(c),module).triggerscript,ordered);
  const applied=applyPacket(c,{schemaVersion:2,task:'lua',data:{scripts:[{ref:'s1_0',code:'local x = 3'}],removeScripts:[],variables:{},removeVariables:[]}});
  assert.equal(applied.triggerscript[0].effect[0].code,'local x = 3');assert.equal(applied.triggerscript[2].effect[0].code,'local x = 2');
});
