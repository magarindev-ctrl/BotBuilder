import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModule, normalizeModules, readInstalledModules, selectInstalledModules, moduleMatches, moduleOptions } from '../src/modules.js';
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
  assert.match(report(state).issues.join(),/정규식.*트리거.*JS.*MCP.*배경/);
  assert.equal(globalThis.__moduleExecuted,undefined);
  state.moduleOptions['script-id'].skipRuntime=true;const result=report(state);
  assert.deepEqual(result.issues,[]);assert.match(result.messages[1].content,/실행 제외 후/);assert.equal(globalThis.__moduleExecuted,undefined);
});
test('unsupported lore decorators are identified and per-entry exclusion allows supported entries',()=>{
  const state=selectInstalledModules(stateFor(),installedModules(),['world-id']);state.modules[0].lorebook[0].content='@@position pt_main\n문구';
  assert.match(report(state).issues.join(),/제작 규칙.*@@/);
  state.moduleOptions['world-id'].excludedLore=[0];assert.deepEqual(report(state).issues,[]);
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
