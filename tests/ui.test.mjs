import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { PREFIX, newSession, snapshot } from '../src/core.js';
import { applyImportedPreset, importPresetFile, savePresetWorkspace, selectModules } from '../src/preset-ui.js';
import { samplePreset, encodePreset } from './preset-fixture.mjs';
import { installedModules, modulePreset } from './modules-fixture.mjs';
import { selectInstalledModules } from '../src/modules.js';

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
async function make(initial = {}, response = { schemaVersion: 1, task: 'workshop', data: { reply: '세계관부터 함께 정해보죠.', changes: [] } }, systemDark = false) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  const media = new dom.window.EventTarget(); media.matches = systemDark;
  dom.window.matchMedia = () => media;
  const store = new Map(Object.entries(initial)), calls = [], regs = {};
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => store.set(k, v), removeItem: async k => store.delete(k) }, registerSetting: async (name, callback) => regs.open = callback, registerButton: async () => ({}), onUnload: async fn => regs.unload = fn, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); return { type: 'success', result: JSON.stringify(response) }; } };
  const app = new Workshop(api, dom.window.document); await app.init(); return { app, dom, store, calls, regs, setSystemDark: dark => { media.matches = dark; media.dispatchEvent(new dom.window.Event('change')); }, close: () => { app.destroy(); dom.window.close(); } };
}
const button = (dom, text) => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);

test('preset file picker accepts the expanded size range and rejects files over 32MiB', async () => {
  const x = await make();
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...samplePreset(), mainPrompt: 'x'.repeat(9 * 1024 * 1024) }));
    x.app.file = async () => ({ name: 'large.json', size: bytes.length, arrayBuffer: async () => bytes.buffer });
    await importPresetFile(x.app); assert.equal(x.app.s.preset.preset.mainPrompt.length, 9 * 1024 * 1024);
    x.app.file = async () => ({ name: 'too-large.json', size: 32 * 1024 * 1024 + 1, arrayBuffer: async () => { throw new Error('must not read oversized file'); } });
    await assert.rejects(importPresetFile(x.app), /32MiB/);
  } finally { x.close(); }
});

test('lore checkbox state follows reorder and persists in both recovery slots', async () => {
  const x = await make();
  try {
    x.app.s.draft.globalLore = [{ key: 'a', comment: 'A', content: 'A' }, { key: 'b', comment: 'B', content: 'B' }];
    x.app.s.tab = 'lorebook'; x.app.task = 'lorebook'; x.app.render();
    x.dom.window.document.querySelectorAll('.lore-request-list input')[1].click();
    assert.deepEqual(x.app.s.loreIncluded, [true, false]);
    button(x.dom, '2. B').click(); button(x.dom, '위로').click(); await wait();
    assert.equal(x.app.s.draft.globalLore[0].key, 'b'); assert.deepEqual(x.app.s.loreIncluded, [false, true]);
    x.app.scopeOnly = true; assert.throws(() => x.app.previewRequest(), /요청에서 제외/); x.app.scopeOnly = false;
    await x.app.saveSlot('manual'); await x.app.autosave();
    for (const slot of ['manual', 'autosave']) assert.deepEqual(x.app.slots[slot].session.loreIncluded, [false, true]);
    button(x.dom, '전체 제외').click(); await wait(); assert.deepEqual(x.app.s.loreIncluded, [false, false]);
    button(x.dom, '전체 포함').click(); await wait(); assert.deepEqual(x.app.s.loreIncluded, [true, true]);
  } finally { x.close(); }
});

test('array response with OOC prose creates no accepted reply or candidate', async () => {
  const x = await make();
  try {
    x.app.task = 'description'; x.app.s.requests.description = '설명 작성';
    x.app.api.runLLMModel = async () => ({ type: 'success', result: 'OOC\n[{"schemaVersion":1,"task":"description","data":{"text":"must not apply"}}]\nend' });
    await x.app.sendRequest();
    assert.equal(x.app.s.candidates.length, 0); assert.equal(x.app.s.draft.desc, ''); assert.ok(x.app.s.thread.at(-1).error);
  } finally { x.close(); }
});

test('lore diff displays changed fields only and JSON guide uses current included refs', async () => {
  const x = await make();
  try {
    x.app.s.draft.globalLore = [{ key: 'a', content: 'hidden-old' }, { key: 'b', comment: 'B', content: 'old' }]; x.app.s.loreIncluded = [false, true];
    const view = x.app.diffView({ before: structuredClone(x.app.s.draft), packet: { task: 'lorebook', data: { upsert: [{ ref: 'l1', entry: { content: 'new' } }], remove: [] } } });
    assert.match(view.textContent, /old/); assert.match(view.textContent, /new/); assert.doesNotMatch(view.textContent, /hidden-old/);
    const pending = x.app.showPrompt('lorebook'); await wait();
    const guide = [...x.dom.window.document.querySelectorAll('details')].find(e => e.querySelector('summary')?.textContent === 'JSON 응답 형식과 예시');
    assert.ok(guide); assert.match(guide.textContent, /올바른 출력 예시/); assert.match(guide.textContent, /"ref": "l1"/);
    x.app.activeModal.close(null); await pending;
  } finally { x.close(); }
});
test('preset OOC prefill stays configured while response leftovers are removed before conversation and proposal handling',async()=>{
  const x=await make();try {
    const preset={...samplePreset(),promptSettings:{assistantPrefill:'## OOC Response\n'}};
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(preset)),'p.json');
    x.app.api.runLLMModel=async options=>{x.calls.push(options);return {type:'success',result:'## OOC Response\n```json\n'+JSON.stringify({schemaVersion:1,task:x.app.task,data:x.app.task==='workshop'?{reply:'리아의 장르부터 정해볼까요?',changes:[]}:{text:'원고 안의 ## 제목과 {중괄호}는 유지합니다.'}})+'\n```\n부가 설명'};};
    x.app.s.requests.workshop='같이 만들자';await x.app.sendRequest();assert.equal(x.app.s.thread.at(-1).content,'리아의 장르부터 정해볼까요?');assert.equal(x.app.s.thread.at(-1).error,undefined);
    assert.equal(x.calls[0].messages.at(-1).content,'## OOC Response\n');
    x.app.task='description';x.app.s.requests.description='설명을 작성해줘';await x.app.sendRequest();
    assert.equal(x.app.s.candidates.length,1);assert.equal(x.app.s.draft.desc,'');assert.equal(x.app.s.candidates[0].packet.data.text,'원고 안의 ## 제목과 {중괄호}는 유지합니다.');
  }finally{x.close();}
});
test('installed-module dialog selects referenced modules read-only and persists modules/toggles through import and recovery',async()=>{
  const x=await make();let y;try {
    const modules=installedModules(),before=JSON.stringify(modules),reads=[];
    x.app.api.getDatabase=async keys=>{reads.push(keys);return {modules};};
    x.app.api.setDatabaseLite=()=>{throw new Error('Host must stay unchanged');};
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(modulePreset())),'p.json');
    const pending=selectModules(x.app);await wait();button(x.dom,'프리셋 참조 모듈 선택').click();await wait();button(x.dom,'선택 모듈 적용').click();await pending;
    assert.deepEqual(reads,[['modules']]);assert.equal(x.app.s.preset.modules.length,1);assert.equal(JSON.stringify(modules),before);
    x.app.s.preset.values.toggle_focus='1';x.app.presetChanged();await savePresetWorkspace(x.app);await x.app.saveSlot('manual');await x.app.autosave();
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(modulePreset())),'new.json');
    assert.equal(x.app.s.preset.modules[0].id,'world-id');assert.equal(x.app.s.preset.values.toggle_focus,'1');
    y=await make(Object.fromEntries(x.store));assert.equal(y.app.s.preset.modules[0].namespace,'world');assert.equal(y.app.s.preset.values.toggle_focus,'1');
    assert.equal(y.app.slots.manual.session.preset.modules.length,1);assert.equal(y.app.slots.autosave.session.preset.modules.length,1);
    x.app.s.requests.workshop='모듈 사용';await x.app.sendRequest();assert.match(JSON.stringify(x.calls[0].messages),/상세 모드/);
    x.app.s.preset.mode='direct';await x.app.sendRequest();assert.doesNotMatch(JSON.stringify(x.calls[1].messages),/모듈 자료|모듈 원문 자료/);
  }finally{y?.close();x.close();}
});
test('module selection cancellation, permission refusal and a session change preserve the current selection',async()=>{
  const x=await make();try {
    const before=JSON.stringify(x.app.s.preset);x.app.api.getDatabase=async()=>({modules:installedModules()});
    const cancelled=selectModules(x.app);await wait();button(x.dom,'취소').click();await cancelled;assert.equal(JSON.stringify(x.app.s.preset),before);
    x.app.api.getDatabase=async()=>null;await assert.rejects(selectModules(x.app),/권한/);assert.equal(JSON.stringify(x.app.s.preset),before);
    let resolve;x.app.api.getDatabase=()=>new Promise(done=>resolve=done);const stale=selectModules(x.app);
    await x.app.replaceSession(newSession());resolve({modules:installedModules()});await assert.rejects(stale,/작업이 바뀌어/);assert.equal(x.app.s.preset.modules.length,0);
  }finally{x.close();}
});
test('runtime exclusion controls block dispatch until explicitly changed and persist their choice',async()=>{
  const x=await make();try {
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify({...modulePreset(),moduleIntergration:'script'})),'p.json');
    x.app.s.preset=selectInstalledModules(x.app.s.preset,installedModules(),['script-id']);x.app.s.preset.pane='modules';x.app.s.tab='preset';x.app.render();
    x.app.s.requests.workshop='검토';await assert.rejects(x.app.sendRequest(),/실행은 지원하지/);assert.equal(x.calls.length,0);
    const row=[...x.dom.window.document.querySelectorAll('label')].find(label=>label.textContent.includes('이 모듈의 요청 관련'));
    const revision=x.app.s.promptRevision,checkbox=row.querySelector('input');checkbox.checked=true;checkbox.dispatchEvent(new x.dom.window.Event('change'));
    assert.ok(x.app.s.promptRevision>revision);await x.app.sendRequest();assert.equal(x.calls.length,1);assert.equal(globalThis.__moduleExecuted,undefined);
    await savePresetWorkspace(x.app);assert.equal(JSON.parse(x.store.get(PREFIX+'preset-workspace')).moduleOptions['script-id'].skipRuntime,true);
  }finally{x.close();}
});
test('presentation-only modules allow dispatch and preserve structured chapter text; diagnostic sources remain text',async()=>{
  const x=await make({},{schemaVersion:1,task:'workshop',data:{reply:'## 제1장',changes:[]}});try {
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify({...modulePreset(),moduleIntergration:'presentation'})),'p.json');
    x.app.s.preset=selectInstalledModules(x.app.s.preset,installedModules(),['presentation-id']);x.app.s.preset.pane='modules';x.app.render();
    assert.match(x.dom.window.document.body.textContent,/출력 정규식 1개/);assert.match(x.dom.window.document.body.textContent,/챕터 표기 수정/);
    assert.equal(x.dom.window.document.querySelectorAll('.editor pre b').length,0);
    x.app.s.requests.workshop='제작하자';await x.app.sendRequest();assert.equal(x.calls.length,1);assert.equal(x.app.s.thread.at(-1).content,'## 제1장');
    assert.equal(x.app.s.preset.moduleOptions['presentation-id'].skipRuntime,false);assert.equal(globalThis.__moduleExecuted,undefined);
  }finally{x.close();}
});
test('preset postprocessing diagnostics and literal user_input allow structured requests without changing exclusion settings',async()=>{
  const x=await make();try {
    const preset={mainPrompt:'',name:'후처리 프리셋',regex:installedModules()[2].regex,promptTemplate:[{type:'plain',role:'system',text:'{{user_input}}'},{type:'chat',rangeStart:0,rangeEnd:'end'}]};
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(preset)),'p.json');x.app.s.preset.pane='context';x.app.render();
    assert.match(x.dom.window.document.body.textContent,/프리셋 정규식 처리 내역/);assert.match(x.dom.window.document.body.textContent,/챕터 표기 수정/);
    x.app.s.requests.workshop='이번 제작 요청';await x.app.sendRequest();assert.equal(x.calls.length,1);assert.equal(x.calls[0].messages[0].content,'{{user_input}}');
    assert.equal(x.app.s.preset.excluded.regex,false);assert.equal(x.app.s.thread.at(-1).error,undefined);
  }finally{x.close();}
});
test('binary preset import, local save, reload and both recovery slots preserve editable toggles',async()=>{
  const x=await make();let y;
  try {
    await applyImportedPreset(x.app,await encodePreset(samplePreset()),'test.risup');
    x.app.s.preset.values.toggle_extra='1';x.app.presetChanged();await savePresetWorkspace(x.app);
    x.app.s.preset.preset.promptTemplate[0].text='편집한 프롬프트';x.app.presetChanged();
    await x.app.saveSlot('manual');await x.app.autosave();
    y=await make(Object.fromEntries(x.store));
    assert.equal(y.app.s.preset.mode,'preset');assert.equal(y.app.s.preset.values.toggle_extra,'1');
    assert.notEqual(y.app.s.preset.preset.promptTemplate[0].text,'편집한 프롬프트');
    assert.equal(y.app.slots.manual.session.preset.preset.promptTemplate[0].text,'편집한 프롬프트');
    assert.equal(y.app.slots.autosave.session.preset.values.toggle_extra,'1');
    y.app.replaceSession(y.app.slots.manual.session);assert.equal(y.app.s.preset.preset.promptTemplate[0].text,'편집한 프롬프트');
    const before=JSON.stringify(y.app.s.preset);
    await assert.rejects(applyImportedPreset(y.app,new Uint8Array([0]),'broken.risup'));assert.equal(JSON.stringify(y.app.s.preset),before);
  } finally{y?.close();x.close();}
});
test('preset preview equals actual transmission, history appears once and unsupported blocks never send',async()=>{
  const x=await make();try {
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(samplePreset())),'p.json');
    x.app.s.thread=[{role:'user',content:'unique_history_token'},{role:'assistant',content:'이전 답'}];
    x.app.s.requests.workshop='구상하자';const report=x.app.previewRequest();
    assert.deepEqual(report.issues,[]);await x.app.sendRequest();assert.deepEqual(x.calls[0].messages,report.messages);
    assert.equal(x.calls[0].messages.filter(m=>m.content.includes('unique_history_token')).length,1);
    x.app.s.preset.preset.promptTemplate[0].text='{{unsupported_macro}}';
    await assert.rejects(x.app.sendRequest(),/CBS/);assert.equal(x.calls.length,1);
    x.app.s.preset.mode='direct';await x.app.sendRequest();assert.equal(x.calls.length,2);
  }finally{x.close();}
});
test('incomplete condition edits survive preset save and reload, and correction unblocks assembly',async()=>{
  const x=await make();let y;try {
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(samplePreset())),'p.json');
    button(x.dom,'조건 추가').click();await wait();
    const input=x.dom.window.document.querySelector('[aria-label="조건 변수 키"]');input.value='';input.dispatchEvent(new x.dom.window.Event('input'));
    const body=x.dom.window.document.querySelector('[aria-label="블록 본문"]');body.value='편집 중인 본문';body.dispatchEvent(new x.dom.window.Event('input'));
    await savePresetWorkspace(x.app);y=await make(Object.fromEntries(x.store));y.app.s.tab='preset';y.app.render();
    assert.equal(y.dom.window.document.querySelector('[aria-label="블록 본문"]').value,'편집 중인 본문');
    assert.ok(y.app.previewRequest().issues.length);
    const key=y.dom.window.document.querySelector('[aria-label="조건 변수 키"]');key.value='toggle_extra';key.dispatchEvent(new y.dom.window.Event('input'));
    assert.equal(y.app.s.preset.preset.promptTemplate[0].workshopError,undefined);assert.deepEqual(y.app.previewRequest().issues,[]);
  }finally{y?.close();x.close();}
});
test('changing a preset toggle discards a pending response and older snapshots still restore',async()=>{
  const x=await make();try {
    await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(samplePreset())),'p.json');
    let resolve;x.app.api.runLLMModel=()=>new Promise(done=>resolve=done);
    x.app.s.requests.workshop='구상';const pending=x.app.sendRequest();await wait();
    x.app.s.preset.values.toggle_extra='1';x.app.presetChanged();
    resolve({type:'success',result:JSON.stringify({schemaVersion:1,task:'workshop',data:{reply:'late',changes:[]}})});
    await pending;assert.equal(x.app.s.thread.at(-1).error,true);
    x.app.replaceSession(newSession());assert.ok(x.app.s.preset);assert.equal(x.app.s.preset.mode,'preset');
  }finally{x.close();}
});
test('workshop renders manuscript + persistent chat, with prompt beside every send action', async () => {
  const x = await make(); try {
    assert.match(x.dom.window.document.body.textContent, /봇빌더/); assert.equal(x.dom.window.document.querySelectorAll('.editor').length, 1); assert.equal(x.dom.window.document.querySelectorAll('.conversation').length, 1);
    assert.ok(x.dom.window.document.querySelector('[data-action="send-request"]')); assert.ok(x.dom.window.document.querySelector('[data-action="prompt"]'));
    const presetTab=[...x.dom.window.document.querySelectorAll('.navitem')].find(e=>e.textContent.includes('프롬프트 프리셋'));presetTab.click();await wait();
    assert.ok(x.dom.window.document.querySelector('[data-action="import-preset"]'));assert.equal(x.app.task,'workshop');
    x.app.s.draft.desc = '<img src=x onerror=alert(1)>'; x.app.s.tab = 'description'; x.app.render(); assert.equal(x.dom.window.document.querySelectorAll('img').length, 0);
  } finally { x.close(); }
});
test('autosave does not overwrite initial recovery data and two slots are independent', async () => {
  const previous = newSession(); previous.draft.name = 'recover me';
  const initial = JSON.stringify(snapshot(previous)), x = await make({ [PREFIX + 'autosave']: initial });
  try {
    await x.app.autosave(); assert.equal(x.store.get(PREFIX + 'autosave'), initial);
    x.app.started = true; x.app.s.draft.name = 'manual draft'; x.app.touch(); await x.app.saveSlot('manual');
    assert.equal(x.store.get(PREFIX + 'autosave'), initial);
    x.app.s.draft.name = 'auto draft'; x.app.touch(); await x.app.autosave();
    assert.equal(JSON.parse(x.store.get(PREFIX + 'manual')).name, 'manual draft'); assert.equal(JSON.parse(x.store.get(PREFIX + 'autosave')).name, 'auto draft');
  } finally { x.close(); }
});
test('send dispatches once without a confirmation dialog and preserves the manuscript', async () => {
  const x = await make(); try {
    x.app.s.requests.workshop = '판타지 시뮬레이션을 구상해보자'; const before = x.app.s.draft.desc;
    x.app.dialog = () => { throw new Error('Request must not open a confirmation dialog'); };
    await x.app.sendRequest();
    assert.equal(x.calls.length, 1); assert.equal(x.calls[0].mode, 'submodel'); assert.equal(x.app.s.thread.length, 2); assert.equal(x.app.s.draft.desc, before); assert.equal(x.app.s.thread[1].content, '세계관부터 함께 정해보죠.');
  } finally { x.close(); }
});
test('generated proposals require explicit apply and stale candidates cannot apply', async () => {
  const x = await make({}, { schemaVersion: 1, task: 'description', data: { text: 'A new character' } });
  try {
    x.app.task = 'description'; x.app.s.requests.description = 'write';
    await x.app.sendRequest();
    assert.equal(x.app.s.draft.desc, ''); assert.equal(x.app.s.candidates.length, 1);
    await x.app.applyCandidate(x.app.s.candidates[0]); assert.equal(x.app.s.draft.desc, 'A new character');
    x.app.s.candidates[0].status = null; x.app.touch(); await assert.rejects(x.app.applyCandidate(x.app.s.candidates[0]), /다른 시점/);
  } finally { x.close(); }
});
test('prompt save and reset affect only selected task', async () => {
  const x = await make(); try {
    const opening = x.app.showPrompt('description'); await wait();
    const area = x.dom.window.document.querySelector('[aria-label="시스템 프롬프트 전체"]'); area.value += '\ncustom'; area.dispatchEvent(new x.dom.window.Event('input'));
    assert.equal(x.store.has(PREFIX + 'prompt:description'), false);
    button(x.dom, '프롬프트 저장').click(); await wait(); assert.match(JSON.parse(x.store.get(PREFIX + 'prompt:description')).system, /custom/);
    x.store.set(PREFIX + 'manual', 'untouched'); x.store.set(PREFIX + 'prompt:greeting', 'untouched');
    button(x.dom, '기본값으로 초기화').click(); await wait(); assert.equal(x.store.has(PREFIX + 'prompt:description'), false); assert.equal(x.store.get(PREFIX + 'manual'), 'untouched'); assert.equal(x.store.get(PREFIX + 'prompt:greeting'), 'untouched');
    x.app.activeModal.close(null); await opening;
  } finally { x.close(); }
});
test('saved prompt survives reload while unsaved prompt edits remain drafts', async () => {
  const x = await make(); let y;
  try {
    const saved = { system: 'saved system', user: 'saved template' };
    await x.app.store('prompt:description', saved);
    x.app.s.promptDrafts.description = { system: 'unsaved change', user: 'unsaved template' };
    x.app.started = true; await x.app.saveSlot('manual');
    y = await make(Object.fromEntries(x.store));
    assert.deepEqual(y.app.prompts.description, saved);
    assert.equal(y.app.slots.manual.session.promptDrafts.description.system, 'unsaved change');
  } finally { y?.close(); x.close(); }
});
test('late model result is discarded after manuscript changes', async () => {
  const x = await make();
  try {
    let resolve;
    x.app.api.runLLMModel = () => new Promise(done => resolve = done);
    x.app.task = 'description'; x.app.s.requests.description = 'write';
    const pending = x.app.sendRequest(); await wait();
    x.app.setField('desc', 'typed while waiting');
    resolve({ type: 'success', result: JSON.stringify({ schemaVersion: 1, task: 'description', data: { text: 'late' } }) });
    await pending;
    assert.equal(x.app.s.draft.desc, 'typed while waiting'); assert.equal(x.app.s.candidates.length, 0); assert.equal(x.app.job, null); assert.equal(x.app.s.thread.at(-1).error, true);
  } finally { x.close(); }
});
test('direct send still blocks duplicate requests and over-limit input', async () => {
  const x = await make();
  try {
    x.app.s.requests.workshop = 'draft';
    x.app.settings.maxInputChars = 1;
    await assert.rejects(x.app.sendRequest(), /한도를 초과/); assert.equal(x.calls.length, 0);
    x.app.settings.maxInputChars = 100000;
    let resolve;
    x.app.api.runLLMModel = () => { x.calls.push('one'); return new Promise(done => resolve = done); };
    const pending = x.app.sendRequest();
    await assert.rejects(x.app.sendRequest(), /진행 중/); await wait(); assert.equal(x.calls.length, 1);
    resolve({ type: 'success', result: JSON.stringify({ schemaVersion: 1, task: 'workshop', data: { reply: 'done', changes: [] } }) }); await pending;
  } finally { x.close(); }
});
test('theme follows system changes until a saved explicit preference overrides them', async () => {
  const x = await make(); let y;
  try {
    assert.equal(x.dom.window.document.documentElement.dataset.theme, 'light');
    x.setSystemDark(true); assert.equal(x.dom.window.document.documentElement.dataset.theme, 'dark');
    const settings = x.app.showSettings(); await wait();
    const select = x.dom.window.document.querySelector('[aria-label="화면 테마"]'); select.value = 'light'; select.dispatchEvent(new x.dom.window.Event('change'));
    button(x.dom, '저장').click(); await settings;
    x.setSystemDark(false); x.setSystemDark(true); assert.equal(x.dom.window.document.documentElement.dataset.theme, 'light');
    y = await make(Object.fromEntries(x.store), undefined, true);
    assert.equal(y.app.settings.theme, 'light'); assert.equal(y.dom.window.document.documentElement.dataset.theme, 'light');
  } finally { y?.close(); x.close(); }
});
