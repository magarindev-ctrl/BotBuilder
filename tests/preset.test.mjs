import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'fflate';
import { encode, decode } from 'msgpackr/index-no-eval';
import { decodePreset, normalizePreset, PRESET_LIMIT } from '../src/preset-format.js';
import { parseToggleTree, toggleDefault, compileV2, parseV2 } from '../src/preset-v2.js';
import { newPresetState, validatePresetState, toggleDefinitions, presetValues, renderPresetText, assemblePreset } from '../src/preset-engine.js';
import { newSession } from '../src/core.js';
import { calculatePreset } from '../src/preset-calc.js';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { encodePreset, samplePreset } from './preset-fixture.mjs';

const stateFor=p=>({...newPresetState(),mode:'preset',preset:normalizePreset(p)});
const context={fields:{char:'별 {{unknown}}',slot:'{{unknown}}'},globals:{toggle_x:'1'},variables:{x:'7'}};
const request=[{role:'system',content:'작업 규칙'},{role:'user',content:'이번 요청 {{not_a_macro}}'}];
const assemble=(p,session=newSession())=>assemblePreset(p,session,'workshop',request);
let referenceFactory;
async function reference(variables={},globals={}) {
  if(!referenceFactory) {
    const source=await readFile(new URL('./fixtures/risubard-cbs-reference.ts',import.meta.url),'utf8');
    const {code}=await transform(source,{loader:'ts',format:'esm'});
    referenceFactory=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).nativeReference;
  }
  return referenceFactory(variables,globals);
}

test('user-reported #if_pure expression with /if closing responds to the imported OOC toggle',()=>{
  const source="# User's input{{#if_pure {{? {{getglobalvar::toggle_OOC}}=2}}}}(What Cattleya have to respond!){{/if}}";
  for(const value of ['0','1','2']) {
    const text=renderPresetText(source,{...context,globals:{toggle_OOC:value}});
    assert.equal(text,"# User's input"+(value==='2'?'(What Cattleya have to respond!)':''));
  }
  assert.equal(renderPresetText('{{#if_pure 1}}\n  kept\n{{/if}}',context),'\n  kept\n');
  assert.equal(renderPresetText('{{#if 2}}hidden{{/if}}',context),'');
  assert.equal(renderPresetText('{{#if_pure 1}}A{{#if 1}}B{{/}}C{{/if}}',context),'ABC');
});
test('infix ? and calc results match pinned upstream RPN functions with local variable bindings',async()=>{
  const variables={score:'7'},globals={toggle_OOC:'2'};const native=await reference(variables,globals);
  const expressions=['0=2','1=2','2=2','2==2','2!=1','1<=2','3>=2','2+3*4','(2+3)*4','2^3^2','-3+5','2*-3','1&&0','1||0','!0','null=0','$score+1','@toggle_OOC=2','(@toggle_OOC=2)&($score>5)','1/0','0/0'];
  for(const source of expressions) {
    const expected=String(native.calcString(source));
    assert.equal(calculatePreset(source,{variables,globals}),expected,source);
    assert.equal(renderPresetText('{{? '+source+'}}',{...context,variables,globals}),expected,source);
    assert.equal(renderPresetText('{{calc::'+source+'}}',{...context,variables,globals}),expected,source);
  }
  assert.throws(()=>calculatePreset('1'.repeat(65537)),/65,536/);
  assert.throws(()=>calculatePreset('('.repeat(51)+'1'+')'.repeat(51)),/중첩/);
});
test('condition booleans, right-to-left when operators and whitespace match pinned upstream blocks',async()=>{
  const globals={toggle_OOC:'2',toggle_x:'1'},variables={score:'7'},native=await reference(variables,globals);
  const headers=['#if 1','#if true','#if 2','#if false','#if_pure 1','#if_pure 0','#when 1','#when 2','#when::keep::1','#when::legacy::1','#when::1::or::0::and::0','#when::1::and::0::or::1','#when::not::0','#when::2::is::2','#when::1::isnot::2','#when::2::>::1','#when::1::<::2','#when::2::>=::2','#when::2::<=::2','#when::var::score','#when::score::vis::7','#when::score::visnot::8','#when::toggle::x','#when::OOC::tis::2','#when::OOC::tisnot::1'];
  const body='\n  first\n    second\n';
  for(const header of headers) {
    const expected=native.blockEndMatcher(body,native.blockStartMatcher(header,{globalChatVariables:globals}),{});
    assert.equal(renderPresetText('{{'+header+'}}'+body+'{{/}}',{...context,variables,globals}),expected,header);
  }
  assert.equal(renderPresetText('{{#when::0}}yes{{:else}}no{{/}}',context),'no');
});
test('cache blocks mark preceding role-filtered messages without adding prompt text',()=>{
  const p={mainPrompt:'',promptTemplate:[{type:'plain',role:'system',text:'system'},{type:'plain',role:'user',text:'user'},{type:'plain',role:'bot',text:'assistant'},{type:'cache',depth:2,role:'all'},{type:'chat',rangeStart:0,rangeEnd:'end'},{type:'cache',depth:1,role:'system'}]};
  const report=assemble(stateFor(p));assert.deepEqual(report.issues,[]);
  assert.deepEqual(report.messages.slice(0,3).map(m=>m.cachePoint),[true,true,true]);
  assert.equal(report.messages.length,4);assert.equal(report.messages[3].cachePoint,undefined);
  assert.equal(report.trace[3].status,'metadata');assert.deepEqual(report.trace[3].targets,[2,1]);
  p.promptTemplate[3].depth=0;p.promptTemplate[5].enabled=false;
  assert.equal(assemble(stateFor(p)).messages.some(m=>m.cachePoint),false);
  p.promptTemplate[3].depth=-1;assert.match(assemble(stateFor(p)).issues.join(),/깊이/);
});
test('standalone and inline :else branches preserve the native keep and normal whitespace rules',async()=>{
  const native=await reference();
  for(const header of ['#when::1','#when::0','#when::keep::1','#when::keep::0'])for(const body of [' A {{:else}} B ','\n  A\n{{:else}}\n  B\n','A\n  {{:else}} \nB']) {
    const expected=native.blockEndMatcher(body,native.blockStartMatcher(header,{}),{});
    assert.equal(renderPresetText('{{'+header+'}}'+body+'{{/}}',context),expected,header+': '+body);
  }
});
test('empty comma-separated module references do not block; real references explain explicit exclusion',()=>{
  const s=stateFor({...samplePreset(),moduleIntergration:' , , '});assert.deepEqual(assemble(s).issues,[]);
  s.preset.moduleIntergration='module-a, module-b,module-a';const error=assemble(s).issues.join();
  assert.match(error,/module-a, module-b/);assert.match(error,/참고자료/);assert.match(error,/포함되지 않습니다/);
  assert.equal(s.excluded.modules,false);
});

test('upstream-compatible AES-GCM + gzip + MessagePack + RPack preset formats decode',async()=>{
  for(const [name,options] of [['a.risup',{}],['a.risupreset',{rpack:false}],['old.risupreset',{rpack:false,version:0,field:'pres'}]]) {
    const p=decodePreset(await encodePreset(samplePreset(),options),name);
    assert.equal(p.name,'검증용 프리셋');assert.equal(p.promptTemplate[2].rangeEnd,'end');
  }
});
test('preset import filters connection credentials and rejects non-preset or malformed data',()=>{
  const p=decodePreset(new TextEncoder().encode(JSON.stringify({...samplePreset(),apiKey:'secret',aiModel:'private',openAIKey:'secret'})),'p.json');
  assert.equal(p.apiKey,undefined);assert.equal(p.aiModel,undefined);assert.equal(p.openAIKey,undefined);
  assert.throws(()=>normalizePreset({name:'not a preset'}),/필드/);
  assert.throws(()=>normalizePreset(JSON.parse('{"mainPrompt":"x","__proto__":{}}')),/허용하지 않는/);
  assert.throws(()=>normalizePreset({...samplePreset(),promptTemplate:[{type:'plain',text:7}]}),/문자열/);
  assert.throws(()=>decodePreset(new Uint8Array([255]),'p.json'),/UTF-8/);
});
test('corrupt binary, authentication failure, unknown version and expansion limits reject',async()=>{
  const binary=await encodePreset(samplePreset(),{rpack:false});binary[15]^=255;
  assert.throws(()=>decodePreset(binary,'p.risupreset'),/읽지 못|복호화/);
  const wrapper=decode(gunzipSync(await encodePreset(samplePreset(),{rpack:false})));wrapper.preset[0]^=1;
  assert.throws(()=>decodePreset(gzipSync(encode(wrapper)),'p.risupreset'),/복호화/);
  assert.throws(()=>decodePreset(gzipSync(new Uint8Array(PRESET_LIMIT+1)),'p.risupreset'),/8MiB/);
  assert.throws(()=>decodePreset(new Uint8Array(PRESET_LIMIT+1),'p.json'),/8MiB/);
  assert.throws(()=>decodePreset(new Uint8Array(),'p.risup'),/읽지 못/);
  assert.throws(()=>decodePreset(new Uint8Array([1,2,3]),'p.risup'),/읽지 못/);
  const unknown=await encodePreset(samplePreset(),{version:9,rpack:false});
  assert.throws(()=>decodePreset(unknown,'p.risupreset'),/버전/);
});
test('toggle tree preserves groups and switch/select/text/textarea native index values',()=>{
  const p=samplePreset();p.customPromptTemplateToggle+='\nname=이름=text\n=설명=caption\n==divider';
  const tree=parseToggleTree(p.customPromptTemplateToggle);
  assert.equal(tree.items[0].type,'group');assert.equal(tree.definitions.length,4);
  assert.deepEqual(tree.definitions.map(toggleDefault),['0','0','','']);
  const s=stateFor(p);s.values={toggle_extra:'1',toggle_tone:'1',toggle_note:'메모',toggle_name:'이름'};
  assert.equal(presetValues(s).toggle_tone,'1');
  s.values.toggle_tone='활기참';assert.throws(()=>presetValues(s),/선택형/);
  p.customPromptTemplateToggle+='\nextra=중복';assert.throws(()=>toggleDefinitions(p),/중복/);
});
test('v2 condition edits roundtrip and evaluate toggle comparisons with AND/OR',()=>{
  for(const join of ['and','or']) {
    const activation={join,conditions:[{key:'toggle_x',operator:'is',value:'1'},{key:'toggle_x',operator:'greater',value:'0'}]};
    const source=compileV2('활성 {{char}}',activation);
    assert.deepEqual(parseV2(source),{body:'활성 {{char}}',activation});
    assert.match(renderPresetText(source,context),/활성 별 \{\{unknown\}\}/);
    assert.equal(renderPresetText(source,{...context,globals:{toggle_x:'0'}}),'');
  }
  assert.throws(()=>compileV2('x',{join:'and',conditions:[{key:'x',operator:'is',value:'{{x}}'}]}),/조건/);
});
test('CBS evaluates nested branches, comments and variables without reparsing inserted values',()=>{
  assert.equal(renderPresetText('{{#if {{equal::{{getvar::x}}::7}}}}yes{{else}}{{unsupported}}{{/if}}',context),'yes');
  assert.equal(renderPresetText('{{#when::keep::0}}{{unsupported}}{{/when}}ok',context),'ok');
  assert.equal(renderPresetText('{{slot}} / {{char}} {{//memo}}',context),'{{unknown}} / 별 {{unknown}} ');
  assert.equal(renderPresetText('{{upper::test}} {{not::0}}',context),'TEST 1');
  assert.equal(renderPresetText('{{getvar::constructor}}',context),'null');
  assert.throws(()=>renderPresetText('{{getglobalvar::missing}}',context),/전역 변수/);
  assert.throws(()=>renderPresetText('{{unknown}}',context),/지원하지 않는/);
  assert.equal(renderPresetText('{{#if 1}}x{{/when}}',context),'x');
  assert.throws(()=>renderPresetText('x{{/if}}',context),/열린 CBS/);
  assert.throws(()=>renderPresetText('{{#if 1}}'.repeat(60)+'x'+'{{/if}}'.repeat(60),context),/중첩/);
});
test('assembly keeps block order, roles, selected conditions, history and current request once',()=>{
  const s=stateFor(samplePreset()),session=newSession();session.draft.name='별';
  session.thread=[{role:'user',content:'이전 질문'},{role:'assistant',content:'이전 답'},{role:'assistant',content:'실패',error:true}];
  s.values.toggle_extra='1';
  let report=assemble(s,session);assert.deepEqual(report.issues,[]);
  assert.deepEqual(report.messages.map(m=>m.role),['system','system','user','assistant','user']);
  assert.equal(report.messages.at(-1).content,'[공방 작업 지침]\n작업 규칙\n\n이번 요청 {{not_a_macro}}');
  assert.equal(report.messages.filter(m=>m.content.includes('이번 요청')).length,1);
  s.values.toggle_extra='0';report=assemble(s,session);assert.equal(report.messages.length,4);assert.equal(report.trace[1].status,'empty');
});
test('missing or overlapping chat ranges block transmission rather than losing or duplicating the request',()=>{
  const s=stateFor(samplePreset());s.preset.promptTemplate[2].rangeEnd=-1;
  assert.match(assemble(s).issues.join(),/0회/);
  s.preset.promptTemplate.push({type:'chat',rangeStart:0,rangeEnd:'end'},{type:'chat',rangeStart:-1,rangeEnd:'end'});
  assert.match(assemble(s).issues.join(),/2회/);
  s.preset.promptTemplate[2].rangeStart='invalid';assert.match(assemble(s).issues.join(),/범위/);
});
test('typed contexts, slot format, local variables and assistant prefill compose explicitly',()=>{
  const s=stateFor({mainPrompt:'x',templateDefaultVariables:'x=1',promptSettings:{assistantPrefill:'{{getvar::x}}'},promptTemplate:[
    {type:'description',innerFormat:'<description>{{slot}}</description>',role2:'bot'},
    {type:'persona'},{type:'authornote'},{type:'memory'},{type:'lorebook'},{type:'chat',rangeStart:0,rangeEnd:'end'}
  ]});
  Object.assign(s.environment,{persona:'인물',authorNote:'작가 {{literal}}',memory:'메모'});
  const session=newSession();session.draft.desc='{{keep_literal}}';session.draft.defaultVariables='x=2';session.draft.globalLore=[{comment:'장소',content:'도시'}];
  const report=assemble(s,session);assert.deepEqual(report.issues,[]);
  assert.deepEqual(report.messages.slice(0,5).map(m=>m.content),['<description>{{keep_literal}}</description>','인물','작가 {{literal}}','메모','[장소]\n도시']);
  assert.equal(report.messages[0].role,'assistant');assert.equal(report.messages.at(-1).content,'2');
  s.preset.promptTemplate[0].innerFormat='lost';assert.match(assemble(s,session).issues.join(),/slot/);
});
test('typed lore wrapper conditions and imported legacy block flags are applied',()=>{
  const s=stateFor({...samplePreset(),jailbreakToggle:false,chainOfThought:false});
  s.preset.promptTemplate.unshift({type:'lorebook',innerFormat:compileV2('{{slot}}',{join:'and',conditions:[{key:'toggle_extra',operator:'is',value:'1'}]})},{type:'jailbreak',text:'disabled'},{type:'cot',text:'disabled'});
  const session=newSession();session.draft.globalLore=[{key:'x',content:'조건부 로어'}];
  assert.deepEqual(assemble(s,session).issues,[]);assert.doesNotMatch(JSON.stringify(assemble(s,session).messages),/disabled|조건부 로어/);
  s.values.toggle_extra='1';assert.match(JSON.stringify(assemble(s,session).messages),/조건부 로어/);
});
test('external modules, regex and overlays require explicit exclusion; unsupported syntax stays blocked',()=>{
  const s=stateFor({...samplePreset(),moduleIntergration:'module',regex:[{}],promptBlockOverlay:{enabled:true}});
  assert.equal(assemble(s).issues.length,3);
  s.excluded={modules:true,regex:true,overlay:true};assert.deepEqual(assemble(s).issues,[]);
  s.preset.promptTemplate.unshift({type:'futureFeature'});assert.match(assemble(s).issues.join(),/유형/);
  s.preset.promptTemplate[0].enabled=false;s.preset.promptTemplate[1].text='{{run_host_code}}';
  assert.match(assemble(s).issues.join(),/CBS/);
  s.preset.promptTemplate[1].enabled=false;s.preset.promptSettings.sendName=true;
  assert.match(assemble(s).issues.join(),/sendName/);
});
test('legacy formatting order maps lastChat without duplicating the current request',()=>{
  const s=stateFor({mainPrompt:'기본',globalNote:'마지막',formatingOrder:['main','chats','lastChat','globalNote']});
  const session=newSession();session.thread=[{role:'assistant',content:'이전'}];
  const report=assemble(s,session);assert.deepEqual(report.issues,[]);
  assert.deepEqual(report.messages.map(m=>m.role),['system','assistant','user','system']);
});
test('ChatML roles and disabled blocks preserve user-controlled order',()=>{
  const s=stateFor(samplePreset());s.preset.promptTemplate.unshift({type:'chatML',text:'<|im_start|>assistant\npreface<|im_end|>'},{type:'plain',text:'{{bad}}',enabled:false});
  assert.deepEqual(assemble(s).issues,[]);assert.equal(assemble(s).messages[0].role,'assistant');
  s.preset.promptTemplate[0].text='invalid';assert.match(assemble(s).issues.join(),/ChatML/);
  s.preset.promptTemplate[0]={type:'plain',text:'bad role',role:'constructor'};assert.match(assemble(s).issues.join(),/역할/);
});
test('workspace validation rejects corrupt switches and global data without mutating input',()=>{
  const s=stateFor(samplePreset());const copy=JSON.stringify(s);const value=validatePresetState(s);value.preset.name='changed';assert.equal(JSON.stringify(s),copy);
  assert.throws(()=>validatePresetState({...s,excluded:{regex:'yes'}}),/참\/거짓/);
  assert.throws(()=>validatePresetState({...s,environment:{...s.environment,globals:{x:7}}}),/키·값/);
});
