import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModule, normalizeModules, readInstalledModules, selectInstalledModules, moduleMatches, moduleOptions, moduleRuntimeProfile } from '../src/modules.js';
import { newPresetState, validatePresetState, toggleDefinitions, presetValues, assemblePreset, renderPresetText } from '../src/preset-engine.js';
import { newSession } from '../src/core.js';
import { installedModules, modulePreset } from './modules-fixture.mjs';

const stateFor=()=>({...newPresetState(),preset:modulePreset(),mode:'preset'});
const request=[{role:'system',content:'작업 지침'},{role:'user',content:'이번 요청'}];
const report=state=>assemblePreset(state,newSession(),'workshop',request);
test('installed module reads request only modules, deduplicate IDs and never write host state',async()=>{
  const source=installedModules(),before=JSON.stringify(source),calls=[];
  const list=await readInstalledModules({getDatabase:async keys=>{calls.push(keys);return {modules:[source[0],source[0],null,source[1]]};}});
  assert.deepEqual(calls,[['modules']]);assert.equal(list.length,2);
  const selected=selectInstalledModules(stateFor(),list,['world-id']);selected.modules[0].name='local';
  assert.equal(JSON.stringify(source),before);
  await assert.rejects(readInstalledModules({getDatabase:async()=>null}),/권한/);
  await assert.rejects(readInstalledModules({}),/조회 API/);
});
test('selection resolves ID and namespace while preserving database order and prompt-only snapshots',()=>{
  const source=installedModules();source[0].apiKey='do not persist';source[0].lowLevelAccess=true;
  const state=selectInstalledModules(stateFor(),source,['script-id','world-id']);
  assert.deepEqual(state.modules.map(m=>m.id),['world-id','script-id']);
  assert.equal(state.modules[0].apiKey,undefined);assert.equal(state.modules[0].lowLevelAccess,undefined);
  assert.equal(moduleMatches(state.modules[0],'world'),true);assert.equal(moduleMatches(state.modules[0],'world-id'),true);
  assert.throws(()=>selectInstalledModules(state,source,['missing']),/설치 목록/);
});
test('module and preset toggles merge compatible shared keys and block conflicting definitions',()=>{
  const state=selectInstalledModules(stateFor(),installedModules(),['world-id']);
  assert.deepEqual(toggleDefinitions(state.preset,state.modules).definitions.map(d=>d.key),['toggle_focus']);
  state.preset.customPromptTemplateToggle='focus=프리셋 집중=select=기본,상세';
  assert.equal(toggleDefinitions(state.preset,state.modules).definitions.length,1);
  assert.deepEqual(toggleDefinitions(state.preset,state.modules).definitions[0].sources,['프리셋','세계관 모듈']);
  state.values.toggle_focus='1';assert.equal(presetValues(state).toggle_focus,'1');
  state.preset.customPromptTemplateToggle='focus=집중';assert.throws(()=>presetValues(state),/형식 충돌/);
});
test('module lore CBS uses local toggles, reaches lore blocks and records per-entry provenance',()=>{
  const state=selectInstalledModules(stateFor(),installedModules(),['world-id']);state.values.toggle_focus='1';
  let result=report(state);assert.deepEqual(result.issues,[]);
  assert.equal(result.messages[0].content,'모듈 연결=1');assert.match(result.messages[1].content,/상세 모드/);
  assert.equal(result.moduleTrace.filter(r=>r.status==='included').length,2);
  state.moduleOptions['world-id'].excludedLore=[1];result=report(state);
  assert.doesNotMatch(result.messages[1].content,/모듈 원문 자료/);
  assert.equal(result.moduleTrace.find(r=>r.index===1).status,'excluded');
  state.values.toggle_focus='0';assert.doesNotMatch(report(state).messages[1].content,/상세 모드/);
});
test('unresolved references, missing lore destinations and explicit global exclusion are distinct',()=>{
  const state=stateFor();assert.match(report(state).issues.join(),/선택되지/);
  Object.assign(state,selectInstalledModules(state,installedModules(),['world-id']));
  state.preset.promptTemplate=state.preset.promptTemplate.filter(b=>b.type!=='lorebook');assert.match(report(state).issues.join(),/로어북을 포함/);
  state.preset.promptTemplate[0].text='{{lorebook}}';assert.deepEqual(report(state).issues,[]);
  state.preset.promptTemplate[0].text='{{moduleenabled::world}}';state.excluded.modules=true;
  const result=report(state);assert.deepEqual(result.issues,[]);assert.equal(result.messages[0].content,'0');assert.equal(result.moduleTrace[0].status,'excluded');
  assert.equal(Object.hasOwn(presetValues(state),'toggle_focus'),false);
});
test('runtime components block until explicitly excluded and no module code is executed',()=>{
  const state=selectInstalledModules({...stateFor(),preset:{...modulePreset(),moduleIntergration:'script'}},installedModules(),['script-id']);
  assert.match(report(state).issues.join(),/전처리 정규식.*콜백 트리거.*모듈 JS.*MCP/);
  assert.doesNotMatch(report(state).issues.join(),/배경/);
  assert.equal(globalThis.__moduleExecuted,undefined);
  state.moduleOptions['script-id'].skipRuntime=true;const result=report(state);
  assert.deepEqual(result.issues,[]);assert.match(result.messages[1].content,/실행 제외 후/);assert.equal(globalThis.__moduleExecuted,undefined);
});
test('63 output rules and presentation features do not block BB requests or alter response data',()=>{
  const source=installedModules(),module=source[2];
  module.regex=Array.from({length:63},(_,i)=>({...module.regex[0],comment:'챕터 수정 '+i}));
  const state=selectInstalledModules({...stateFor(),preset:{...modulePreset(),moduleIntergration:'presentation'}},source,['presentation-id']);
  const result=report(state);assert.deepEqual(result.issues,[]);assert.equal(state.moduleOptions['presentation-id'].skipRuntime,false);
  assert.ok(result.moduleTrace.some(row=>row.status==='not-applicable'&&row.features.includes('출력 정규식 63개')));
  assert.equal(globalThis.__moduleExecuted,undefined);
});
test('input/process and unknown rules remain blocked while output/display and empty IN are scoped out',()=>{
  const module=normalizeModule({...installedModules()[2],regex:[
    {type:'editinput',in:'a',out:'b'},{type:'editprocess',in:'a',out:'b'},
    {type:'editoutput',in:'a',out:'b'},{type:'editdisplay',in:'a',out:'b'},
    {type:'editprocess',in:'',out:'b'},{type:'unknown',in:'a',out:'b'}
  ]});
  const profile=moduleRuntimeProfile(module);
  assert.equal(profile.items.filter(item=>item.status==='unsupported').length,3);
  assert.equal(profile.items.find(item=>item.kind==='regex'&&item.index===4).status,'not-applicable');
  assert.deepEqual(profile.blocking,['입력 정규식 1개','전처리 정규식 1개','유형 미확인 정규식 1개']);
});
test('Lua and JS callback triggers remain relevant despite display/manual/output event labels',()=>{
  const module=normalizeModule({...installedModules()[2],trigger:['manual','display','output'].map(type=>({type,conditions:[],effect:[{type:'triggerlua',code:'listenEdit("editInput", function() end)'}]}))});
  assert.deepEqual(moduleRuntimeProfile(module).blocking,['Lua·JS 콜백 트리거 3개']);
  module.trigger[0].effect[0].type='triggercode';assert.equal(moduleRuntimeProfile(module).blocking[0],'Lua·JS 콜백 트리거 3개');
  module.trigger.push({type:'constructor',conditions:[],effect:[]});assert.ok(moduleRuntimeProfile(module).blocking.includes('유형 미확인 트리거 1개'));
});
test('legacy explicit runtime exclusions remain intact with phase-specific diagnostics',()=>{
  const state=selectInstalledModules({...stateFor(),preset:{...modulePreset(),moduleIntergration:'script'}},installedModules(),['script-id']);
  state.moduleOptions['script-id'].skipRuntime=true;const restored=validatePresetState(state),result=report(restored);
  assert.deepEqual(result.issues,[]);assert.equal(restored.moduleOptions['script-id'].skipRuntime,true);
  assert.ok(result.moduleTrace.some(row=>row.status==='excluded'&&row.items.some(item=>item.phase==='editprocess')));
  assert.ok(result.moduleTrace.some(row=>row.status==='not-applicable'&&row.items.some(item=>item.kind==='background')));
});
test('preset output/display regex and native-literal user_input do not block or duplicate the current request',()=>{
  const state={...stateFor(),preset:{mainPrompt:'',regex:installedModules()[2].regex,promptTemplate:[{type:'plain',role:'system',text:'유저 인풋 {{user_input}}'},{type:'chat',rangeStart:0,rangeEnd:'end'}]}};
  const result=report(state);assert.deepEqual(result.issues,[]);
  assert.equal(result.messages[0].content,'유저 인풋 {{user_input}}');assert.equal(result.messages.filter(m=>m.content.includes('이번 요청')).length,1);
  assert.ok(result.notes.some(note=>note.includes('{{user_input}}')&&note.includes('원문')));
  assert.equal(result.presetRegexTrace.every(item=>item.status==='not-applicable'),true);assert.equal(state.excluded.regex,false);
  assert.equal(renderPresetText('{{ user_input }}',{fields:{},variables:{},globals:{}}),'{{ user_input }}');
});
test('preset input/process regex remain explicit blockers and saved exclusions still apply',()=>{
  const state={...stateFor(),preset:{mainPrompt:'',regex:[...installedModules()[2].regex,{type:'editinput',in:'a',out:'b'},{type:'editprocess',in:'a',out:'b'}],promptTemplate:[{type:'chat',rangeStart:0,rangeEnd:'end'}]}};
  let result=report(state);assert.match(result.issues.join(),/입력 정규식 1개, 전처리 정규식 1개/);assert.doesNotMatch(result.issues.join(),/표시 정규식|출력 정규식/);
  state.excluded.regex=true;result=report(state);assert.deepEqual(result.issues,[]);assert.equal(result.presetRegexTrace.every(item=>item.status==='excluded'),true);
});
test('reported if user_input block is omitted like native CBS while the chat block contains the request once',()=>{
  const state={...stateFor(),preset:{mainPrompt:'',promptTemplate:[{type:'plain',role:'user',text:'{{#if {{user_input}}}}\n{{user_input}}\n{{/if}}'},{type:'chat',rangeStart:0,rangeEnd:'end'}]}};
  const result=report(state);assert.deepEqual(result.issues,[]);assert.equal(result.trace[0].status,'empty');
  assert.equal(result.messages.length,1);assert.equal(result.messages[0].role,'user');assert.match(result.messages[0].content,/이번 요청/);
  assert.doesNotMatch(JSON.stringify(result.messages),/user_input/);
});
test('unsupported lore decorators are identified and per-entry exclusion allows supported entries',()=>{
  const state=selectInstalledModules(stateFor(),installedModules(),['world-id']);state.modules[0].lorebook[0].content='@@position pt_main\n문구';
  assert.match(report(state).issues.join(),/제작 규칙.*@@/);
  state.moduleOptions['world-id'].excludedLore=[0];assert.deepEqual(report(state).issues,[]);
});
test('relaxed module conditions keep entries: decorators stripped, unknown conditions false, unknown macros empty, toggles still honored',()=>{
  const state=selectInstalledModules(stateFor(),installedModules(),['world-id']);
  state.modules[0].lorebook[0].content='@@depth 4\n@@activate_only_after 3\n본문 {{#if {{random::a::b}}}}미지원{{:else}}거짓분기{{/if}} {{random::x}}끝 {{#if {{getglobalvar::toggle_focus}}}}켜짐{{/if}} {{#when::toggle::nope}}없는토글{{/when}}';
  state.values.toggle_focus='1';
  const strict=report(state);assert.match(strict.issues.join(),/@@/);assert.match(strict.issues.join(),/본문만 포함/);
  state.moduleOptions['world-id'].relaxConditions=true;
  const result=report(state);assert.deepEqual(result.issues,[]);
  const text=result.messages.map(m=>m.content).join('\n');
  assert.match(text,/본문 거짓분기 끝 켜짐/);assert.doesNotMatch(text,/@@depth|미지원|없는토글/);
  const record=result.moduleTrace.find(r=>r.index===0);assert.equal(record.status,'included');
  assert.ok(record.relaxed.some(n=>n.includes('@@')));assert.ok(record.relaxed.some(n=>n.includes('거짓')));assert.ok(record.relaxed.some(n=>n.includes('빈 값')));
  state.values.toggle_focus='0';assert.doesNotMatch(report(state).messages.map(m=>m.content).join('\n'),/켜짐/);
  const plain=selectInstalledModules(stateFor(),installedModules(),['world-id']);plain.moduleOptions['world-id'].relaxConditions=true;
  assert.equal(report(plain).moduleTrace.find(r=>r.index===0).relaxed,undefined,'entries without relaxed handling carry no note');
});
test('relaxConditions is validated, kept for unchanged modules and reset when the module changes',()=>{
  const state=selectInstalledModules(stateFor(),installedModules(),['world-id']);
  state.moduleOptions['world-id'].relaxConditions='yes';assert.throws(()=>report(state),/모듈 적용 설정이 올바르지 않습니다/);
  state.moduleOptions['world-id'].relaxConditions=true;
  assert.equal(selectInstalledModules(state,installedModules(),['world-id']).moduleOptions['world-id'].relaxConditions,true);
  const changed=installedModules();changed.find(m=>m.id==='world-id').lorebook[0].content='바뀜';
  assert.equal(selectInstalledModules(state,changed,['world-id']).moduleOptions['world-id'].relaxConditions,false);
  assert.equal(moduleOptions({moduleOptions:{'world-id':{skipRuntime:false,excludedLore:[]}}},{id:'world-id'}).relaxConditions,false,'old saved options default to strict');
});
test('refreshing changed installed modules resets exclusions; unchanged modules and old state migrate safely',()=>{
  let state=selectInstalledModules(stateFor(),installedModules(),['world-id']);state.moduleOptions['world-id'].excludedLore=[0];
  state=selectInstalledModules(state,installedModules(),['world-id']);assert.deepEqual(moduleOptions(state,state.modules[0]).excludedLore,[0]);
  const changed=installedModules();changed[0].lorebook[0].content='updated';state=selectInstalledModules(state,changed,['world-id']);assert.deepEqual(moduleOptions(state,state.modules[0]).excludedLore,[]);
  const older=stateFor();delete older.modules;delete older.moduleOptions;assert.deepEqual(validatePresetState(older).modules,[]);
});
test('malformed module records/options fail atomically and module asset macros return names only',()=>{
  assert.throws(()=>normalizeModule({id:'bad',lorebook:[{content:7}]}),/본문/);
  assert.throws(()=>normalizeModules([installedModules()[0],installedModules()[0]]),/중복/);
  const state=selectInstalledModules(stateFor(),installedModules(),['world-id']);state.moduleOptions['world-id'].excludedLore=[9];assert.throws(()=>validatePresetState(state),/적용 설정/);
  const context={fields:{},globals:{},variables:{},modules:[normalizeModule(installedModules()[0])]};
  assert.equal(renderPresetText('{{module_assetlist::world}}',context),'["지도"]');assert.equal(renderPresetText('{{moduleassetlist::missing}}',context),'');
});
