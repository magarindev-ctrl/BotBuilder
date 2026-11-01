import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { PREFIX, newSession, snapshot, restoreSnapshot, editable } from '../src/core.js';
import { applyImportedPreset, importPresetFile, savePresetWorkspace, selectModules } from '../src/preset-ui.js';
import { samplePreset, encodePreset } from './preset-fixture.mjs';
import { installedModules, modulePreset } from './modules-fixture.mjs';
import { selectInstalledModules } from '../src/modules.js';

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
async function make(initial = {}, response = { schemaVersion: 1, task: 'workshop', data: { reply: '세계관부터 함께 정해보죠.', changes: [] } }, systemDark = false) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  const media = new dom.window.EventTarget(); media.matches = systemDark;
  dom.window.matchMedia = query => query.includes('prefers-color-scheme') ? media : { matches: false };
  const store = new Map(Object.entries(initial)), calls = [], regs = {};
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => store.set(k, v), removeItem: async k => store.delete(k) }, registerSetting: async (name, callback) => regs.open = callback, registerButton: async () => ({}), onUnload: async fn => regs.unload = fn, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); return { type: 'success', result: JSON.stringify(response) }; } };
  const app = new Workshop(api, dom.window.document); await app.init(); return { app, dom, store, calls, regs, setSystemDark: dark => { media.matches = dark; media.dispatchEvent(new dom.window.Event('change')); }, close: () => { app.destroy(); dom.window.close(); } };
}
const button = (dom, text) => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);

test('character picker renders real buttons, filters search and loads the selected latest character by ID', async () => {
  const x=await make();
  try {
    const chars=['리아','Cattleya','리온'].map((name,i)=>({...newSession().draft,chaId:'char-'+i,name}));
    chars.push({type:'group',name:'그룹',chaId:'group'});
    x.app.api.getDatabase=async()=>({characters:chars});
    const pending=x.app.loadCharacters();await wait();
    const dialog=x.dom.window.document.querySelector('[role=dialog]');
    assert.doesNotMatch(dialog.textContent,/\[object HTML/);
    for(const name of ['리아','Cattleya','리온'])assert.ok(button(x.dom,name));
    assert.equal(button(x.dom,'그룹'),undefined);
    const search=dialog.querySelector('input');
    const query=text=>{search.value=text;search.dispatchEvent(new x.dom.window.Event('input'));};
    query('없는 캐릭터');assert.equal(button(x.dom,'리아'),undefined);assert.equal(button(x.dom,'Cattleya'),undefined);
    query('cAtTl');assert.ok(button(x.dom,'Cattleya'));assert.equal(button(x.dom,'리온'),undefined);
    query('');assert.ok(button(x.dom,'리온'));
    chars[2].desc='선택 직전 최신 설명';button(x.dom,'리온').click();await pending;
    assert.equal(x.app.s.targetId,'char-2');assert.equal(x.app.s.draft.desc,'선택 직전 최신 설명');
  } finally {x.close();}
});
test('alternate greeting arrays render editable controls and redraw after addition and deletion', async () => {
  const x=await make();
  try {
    x.app.s.tab='greeting';x.app.s.draft.alternateGreetings=['첫 상황','둘째 상황'];x.app.render();
    assert.doesNotMatch(x.app.editor.textContent,/\[object HTML/);
    const get=n=>x.dom.window.document.querySelector(`[aria-label="대체 인사말 ${n}"]`);
    assert.equal(get(1).value,'첫 상황');assert.equal(get(2).value,'둘째 상황');
    get(1).value='수정 상황';get(1).dispatchEvent(new x.dom.window.Event('input'));
    assert.equal(x.app.s.draft.alternateGreetings[0],'수정 상황');
    button(x.dom,'대체 인사말 추가').click();await wait();assert.ok(get(3));
    button(x.dom,'삭제').click();await wait();assert.equal(get(1).value,'둘째 상황');assert.equal(get(3),null);
  } finally {x.close();}
});

test('bot icon menu registers, replaces, confirms removal and keeps additional assets', async () => {
  const x=await make();
  try {
    x.app.s.tab='assets';x.app.s.draft.additionalAssets=[['keep','shared','png']];x.app.render();
    assert.ok(button(x.dom,'봇 아이콘 등록'));assert.equal(button(x.dom,'봇 아이콘 해제').disabled,true);
    x.app.file=async()=>({size:3,type:'image/png',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
    let saves=0;x.app.api.saveAsset=async()=>`assets/icon-${++saves}`;
    await x.app.editIcon();assert.equal(x.app.s.draft.image,'assets/icon-1');assert.ok(button(x.dom,'봇 아이콘 교체'));
    await x.app.editIcon();assert.equal(x.app.s.draft.image,'assets/icon-2');
    await x.app.saveSlot('manual');assert.equal(restoreSnapshot(x.app.slots.manual).draft.image,'assets/icon-2');
    x.app.confirm=async()=>false;await x.app.editIcon(true);assert.equal(x.app.s.draft.image,'assets/icon-2');
    x.app.confirm=async()=>true;await x.app.editIcon(true);assert.equal(x.app.s.draft.image,'');
    assert.equal(x.app.s.draft.additionalAssets[0][0],'keep');assert.equal(x.app.s.revision,3);
  } finally { x.close(); }
});
test('cancelled, invalid, failed and stale icon registrations leave the prior icon intact', async () => {
  const x=await make();
  try {
    x.app.s.draft.image='original';x.app.file=async()=>null;await x.app.editIcon();assert.equal(x.app.s.revision,0);
    x.app.file=async()=>({size:21*1024*1024,type:'image/png'});await assert.rejects(x.app.editIcon(),/20MiB/);
    x.app.file=async()=>({size:3,type:'text/plain'});await assert.rejects(x.app.editIcon(),/이미지 파일/);
    x.app.file=async()=>({size:3,type:'image/png',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
    x.app.api.saveAsset=async()=>{throw Error('storage failed');};await assert.rejects(x.app.editIcon(),/storage failed/);
    x.app.api.saveAsset=async()=>{x.app.touch();return 'new';};await assert.rejects(x.app.editIcon(),/원고가 변경/);
    assert.equal(x.app.s.draft.image,'original');
  } finally { x.close(); }
});

test('request locks manuscript controls, cancellation unlocks them and discards late responses', async () => {
  const x=await make();
  try {
    let resolve; x.app.api.runLLMModel=()=>new Promise(r=>{resolve=r;});
    x.app.s.requests.workshop='request'; const pending=x.app.sendRequest(); await wait();
    assert.equal(x.app.root.getAttribute('aria-busy'),'true');
    assert.ok([...x.app.root.querySelectorAll('input,textarea,select,button')].every(el=>el.disabled || el.dataset.action==='cancel-request'));
    button(x.dom,'요청 취소').click(); await pending;
    assert.equal(x.app.root.getAttribute('aria-busy'),'false');assert.equal(x.app.requestInput.disabled,false);
    resolve({type:'success',result:JSON.stringify({schemaVersion:2,task:'workshop',data:{reply:'late',changes:[]}})});await wait();
    assert.ok(!x.app.s.thread.some(m=>m.content==='late'));assert.equal(x.app.s.candidates.length,0);
  } finally { x.close(); }
});
test('prose dialog supports candidate selection, manual ranges and editable replacement before explicit apply', async () => {
  const x=await make();
  try {
    x.app.task='description';x.app.s.requests.description='change';x.app.s.draft.desc='same same';
    x.app.api.runLLMModel=async()=>({type:'success',result:JSON.stringify({schemaVersion:2,task:'description',data:{text:{edits:[{before:'same',after:'new'}]}}})});
    const pending=x.app.sendRequest();await wait();
    button(x.dom,'정확히 일치 · 1행 · 이 구간 선택').click();await wait();
    button(x.dom,'선택 구간으로 수정안 준비').click();await pending;
    assert.equal(x.app.s.draft.desc,'same same');assert.equal(x.app.s.candidates.length,1);
    await x.app.applyCandidate(x.app.s.candidates[0]);assert.equal(x.app.s.draft.desc,'new same');
    const manual=x.app.chooseTextRange({source:'abcdef',edit:{before:'missing',after:'x'},label:'text',candidates:[]});
    const source=x.dom.window.document.querySelector('[aria-label="실제 원문에서 교체 구간 선택"]');
    source.setSelectionRange(1,4);button(x.dom,'선택한 원문 구간 사용').click();await wait();
    const replacement=x.dom.window.document.querySelector('[aria-label="교체할 내용"]');replacement.value='manual';replacement.dispatchEvent(new x.dom.window.Event('input'));
    button(x.dom,'선택 구간으로 수정안 준비').click();
    assert.deepEqual(await manual,{start:1,end:4,after:'manual'});
  } finally { x.close(); }
});

test('asset selection supports cancel, multiple deletion, select all, clear and delete all', async () => {
  const x = await make();
  try {
    x.app.s.draft.additionalAssets = ['one', 'two', 'three'].map(name => [name, name, 'png']);
    x.app.s.tab = 'assets'; x.app.render();
    const boxes = () => [...x.dom.window.document.querySelectorAll('[data-asset-row] input[type=checkbox]')];
    assert.equal(button(x.dom, '선택 삭제').disabled, true);
    boxes()[0].click(); boxes()[2].click(); assert.equal(x.app.s.revision, 0);
    button(x.dom, '선택 삭제').click(); await wait(); button(x.dom, '취소').click(); await wait();
    assert.equal(x.app.s.draft.additionalAssets.length, 3);
    button(x.dom, '선택 삭제').click(); await wait(); button(x.dom, '확인').click(); await wait();
    assert.deepEqual(x.app.s.draft.additionalAssets.map(a => a[0]), ['two']); assert.equal(x.app.s.revision, 1);
    assert.equal(button(x.dom, '선택 삭제').disabled, true);
    button(x.dom, '전체 선택').click(); await wait(); assert.equal(boxes()[0].checked, true);
    button(x.dom, '선택 해제').click(); await wait(); assert.equal(boxes()[0].checked, false);
    button(x.dom, '전체 삭제').click(); await wait(); button(x.dom, '확인').click(); await wait();
    assert.equal(x.app.s.draft.additionalAssets.length, 0); assert.equal(x.app.s.revision, 2);
    assert.equal(button(x.dom, '전체 삭제').disabled, true); assert.equal(boxes().length, 0);
  } finally { x.close(); }
});
test('asset deletion refuses a changed draft or session while confirmation is pending', async () => {
  const x = await make();
  try {
    for (const change of ['revision', 'session']) {
      x.app.s.draft.additionalAssets = [['one', 'path', 'png']];
      let approve; x.app.confirm = () => new Promise(resolve => { approve = resolve; });
      const pending = x.app.deleteAssets([...x.app.s.draft.additionalAssets]);
      if (change === 'revision') x.app.touch(); else x.app.s = { ...x.app.s };
      approve(true); await assert.rejects(pending, /원고가 변경/);
      assert.equal(x.app.s.draft.additionalAssets.length, 1);
    }
    x.app.s.tab = 'assets'; x.app.render();
    x.dom.window.document.querySelector('[data-asset-row] input[type=checkbox]').click();
    x.app.s = { ...newSession(), preset: x.app.s.preset }; x.app.s.tab = 'assets'; x.app.s.draft.additionalAssets = [['new', 'new', 'png']]; x.app.render();
    assert.equal(x.dom.window.document.querySelector('[data-asset-row] input[type=checkbox]').checked, false);
  } finally { x.close(); }
});

test('direct and preset requests review compact v2 patches, recover them, and apply only on explicit approval', async () => {
  for (const mode of ['direct', 'preset']) {
    const x = await make();
    try {
      if (mode === 'preset') await applyImportedPreset(x.app, new TextEncoder().encode(JSON.stringify(samplePreset())), 'preset.json');
      x.app.s.draft.desc = '유지할 첫 줄\n원래 설명\n유지할 마지막 줄';
      x.app.s.draft.triggerscript = [{ comment: '코드 이름', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: 'local mood = "calm"\nprint(mood)' }] }];
      const packet = { schemaVersion: 2, task: 'workshop', data: { reply: '두 구간의 수정안을 제안합니다.', changes: [
        { task: 'description', data: { text: { edits: [{ before: '원래 설명', after: '수정한 설명' }] } } },
        { task: 'lua', data: { scripts: [{ ref: 's0_0', code: { edits: [{ before: '"calm"', after: '"curious"' }] } }], removeScripts: [], variables: {}, removeVariables: [] } }
      ] } };
      x.app.api.runLLMModel = async options => { x.calls.push(options); return { type: 'success', result: '## OOC\n' + JSON.stringify(packet) + '\n설명 끝' }; };
      x.app.s.requests.workshop = '기존 설명과 Lua 일부를 고쳐줘'; await x.app.sendRequest();
      assert.equal(x.calls.length, 1); assert.match(JSON.stringify(x.calls[0].messages), /schemaVersion/); assert.match(JSON.stringify(x.calls[0].messages), /before/);
      assert.equal(x.app.s.candidates.length, 1); assert.match(x.app.s.draft.desc, /원래 설명/);
      const candidate = x.app.s.candidates[0], view = x.app.diffView(candidate);
      assert.match(view.textContent, /부분편집 · 기존 2행/); assert.doesNotMatch(view.textContent, /유지할 마지막 줄|print\(mood\)/);
      await x.app.saveSlot('manual'); const recovered = restoreSnapshot(x.app.slots.manual);
      assert.deepEqual(recovered.candidates[0].packet, packet); await x.app.replaceSession(recovered);
      await x.app.applyCandidate(x.app.s.candidates[0]);
      assert.equal(x.app.s.draft.desc, '유지할 첫 줄\n수정한 설명\n유지할 마지막 줄');
      assert.equal(x.app.s.draft.triggerscript[0].effect[0].code, 'local mood = "curious"\nprint(mood)');
      assert.equal(x.app.s.candidates[0].status, 'applied');
    } finally { x.close(); }
  }
});

test('skipped ambiguous prose edits do not retry or create candidates; later draft changes invalidate proposals', async () => {
  const x = await make();
  try {
    x.app.task = 'description'; x.app.s.requests.description = '부분 수정'; x.app.s.draft.desc = 'same same';
    x.app.api.runLLMModel = async options => { x.calls.push(options); return { type: 'success', result: JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: { edits: [{ before: 'same', after: 'changed' }] } } }) }; };
    x.app.chooseTextRange = async item => { assert.equal(item.candidates.length, 2); return null; };
    await x.app.sendRequest(); assert.equal(x.calls.length, 1); assert.equal(x.app.s.candidates.length, 0); assert.match(x.app.s.thread.at(-1).content, /변경 사항이 없습니다/); assert.equal(x.app.s.draft.desc, 'same same');
    x.app.s.draft.desc = 'same'; x.app.touch(); x.app.s.requests.description = '부분 수정'; await x.app.sendRequest(); assert.equal(x.app.s.candidates.length, 1);
    x.app.s.draft.desc = 'manual edit'; x.app.touch();
    await assert.rejects(x.app.applyCandidate(x.app.s.candidates[0]), /다른 시점/); assert.equal(x.app.s.draft.desc, 'manual edit');
  } finally { x.close(); }
});

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
    x.app.s.preset.mode='direct';x.app.s.requests.workshop='모듈 사용';await x.app.sendRequest();assert.doesNotMatch(JSON.stringify(x.calls[1].messages),/모듈 자료|모듈 원문 자료/);
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
    x.app.s.preset.preset.promptTemplate[0].text='{{unsupported_macro}}';x.app.s.requests.workshop='구상하자';
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
    const presetTab=x.dom.window.document.querySelector('.navitem[data-tab="preset"]');presetTab.click();await wait();
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

test('direct and preset image-only requests preserve preview, clear pending images, restore and require explicit reattachment', async()=>{
 for(const mode of ['direct','preset']) {
  const x=await make();try {
   if(mode==='preset')await applyImportedPreset(x.app,new TextEncoder().encode(JSON.stringify(samplePreset())),'p.json');
   const image={id:'pending',name:'capture.png',mime:'image/png',data:'data:image/png;base64,AQID',width:1,height:1};
   x.app.s.requestImages={workshop:[image]};const expected=x.app.previewRequest().messages;
   await x.app.sendRequest();assert.deepEqual(x.calls[0].messages,expected);assert.match(x.app.s.thread[0].content,/첨부한 화면/);
   assert.equal(x.app.s.requests.workshop,'');assert.deepEqual(x.app.s.requestImages.workshop,[]);assert.deepEqual(x.app.s.thread[0].images,[image]);
   await x.app.saveSlot('manual');const restored=restoreSnapshot(x.app.slots.manual);assert.deepEqual(restored.thread[0].images,[image]);
   x.app.s.requests.workshop='다음 요청';await x.app.sendRequest();assert.equal(x.calls[1].messages.flatMap(m=>m.multimodals??[]).length,0);
   button(x.dom,'이미지 다시 첨부').click();await wait();assert.equal(x.app.s.requestImages.workshop.length,1);assert.notEqual(x.app.s.requestImages.workshop[0].id,image.id);
   button(x.dom,'첨부 삭제').click();await wait();assert.deepEqual(x.app.s.requestImages.workshop,[]);
  }finally{x.close();}
 }
});
test('conflict dialog requires an explicit selection and cancellation leaves host untouched', async()=>{
 const x=await make();try {
  const {sessionFromCharacter,clone}=await import('../src/core.js');
  const initial=newSession().draft;initial.desc='base';let current=clone(initial),writes=0;
  await x.app.replaceSession(sessionFromCharacter(initial));x.app.s.draft.desc='BB draft';x.app.touch();current.desc='host edit';
  x.app.api.getDatabase=async()=>({characters:[current]});x.app.api.getCharacterFromIndex=async()=>clone(current);x.app.api.setCharacterToIndex=async(_,next)=>{writes++;current=clone(next);};x.app.confirm=async()=>true;
  let pending=x.app.saveHost();await wait();assert.match(x.dom.window.document.querySelector('[role=dialog]').textContent,/처음 불러왔던 내용/);
  button(x.dom,'선택한 내용으로 저장').click();await wait();assert.equal(writes,0);assert.ok(x.app.activeModal);
  button(x.dom,'취소 · 원고 유지').click();await pending;assert.equal(writes,0);assert.equal(x.app.s.draft.desc,'BB draft');assert.equal(x.app.ioBusy,false);
  pending=x.app.saveHost();await wait();const choice=x.dom.window.document.querySelector('[aria-label="캐릭터 설명 저장 방식"]');choice.value='draft';choice.dispatchEvent(new x.dom.window.Event('change'));
  button(x.dom,'선택한 내용으로 저장').click();await pending;assert.equal(writes,1);assert.equal(current.desc,'BB draft');assert.equal(x.app.s.base.desc,'BB draft');
 }finally{x.close();}
});
test('changing the draft during save-conflict review prevents the write', async()=>{
 const x=await make();try {
  const {sessionFromCharacter,clone}=await import('../src/core.js');const initial=newSession().draft;initial.desc='base';const current=clone(initial);current.desc='host';
  await x.app.replaceSession(sessionFromCharacter(initial));x.app.s.draft.desc='draft';x.app.touch();let writes=0;
  x.app.api.getDatabase=async()=>({characters:[current]});x.app.api.getCharacterFromIndex=async()=>clone(current);x.app.api.setCharacterToIndex=async()=>{writes++;};x.app.confirm=async()=>true;
  x.app.reviewSaveConflicts=async()=>{x.app.setField('desc','new draft');return {desc:'draft'};};
  await assert.rejects(x.app.saveHost(),/검토 중/);assert.equal(writes,0);assert.equal(x.app.s.draft.desc,'new draft');assert.equal(x.app.ioBusy,false);
 }finally{x.close();}
});

test('tab clicks, list selection and model choice never start a session or trigger an autosave', async () => {
  const x = await make(); try {
    const doc = x.dom.window.document;
    doc.querySelector('.navitem[data-tab="description"]').click(); await wait();
    doc.querySelector('.navitem[data-tab="lorebook"]').click(); await wait();
    assert.equal(x.app.started, false); assert.equal(x.app.dirty(), false);
    assert.match(x.app.statusEl.textContent, /^변경 없음 · 자동 저장 없음 · 임시 저장 없음$/);
    const model = doc.querySelector('select[aria-label="LLM 모델"]'); model.value = 'model'; model.dispatchEvent(new x.dom.window.Event('change')); await wait();
    assert.equal(x.app.settings.model, 'model'); assert.equal(x.app.started, false);
    await x.app.autosave(); assert.equal(x.store.has(PREFIX + 'autosave'), false);
    x.app.setField('desc', '실제 편집'); assert.equal(x.app.started, true); assert.match(x.app.statusEl.textContent, /^원고 편집 중/);
    await x.app.autosave(); assert.equal(x.store.has(PREFIX + 'autosave'), true);
  } finally { x.close(); }
});

test('error toasts stay until closed and notices fade; both are replaced by the next toast', async () => {
  const x = await make(); try {
    const doc = x.dom.window.document;
    x.app.toast('프리셋 조립 오류:\n첫 줄\n둘째 줄', true);
    const bad = doc.querySelector('.toast.bad'); assert.ok(bad); assert.equal(bad.getAttribute('role'), 'alert');
    assert.equal(bad.querySelector('.toast-text').textContent, '프리셋 조립 오류:\n첫 줄\n둘째 줄');
    await new Promise(resolve => setTimeout(resolve, 30)); assert.ok(doc.querySelector('.toast.bad'), 'error toast must not fade on its own');
    bad.querySelector('.toast-close').click(); await wait(); assert.equal(doc.querySelector('.toast'), null);
    x.app.toast('안내'); const notice = doc.querySelector('.toast'); assert.ok(notice); assert.equal(notice.querySelector('.toast-close'), null); assert.equal(notice.getAttribute('role'), 'status');
    x.app.toast('다음 안내'); assert.equal(doc.querySelectorAll('.toast').length, 1);
  } finally { x.close(); }
});

test('autosave keeps the three most recent snapshots in order and recovery lists them', async () => {
  const x = await make(); try {
    for (const name of ['첫 저장', '둘째 저장', '셋째 저장', '넷째 저장']) { x.app.setField('name', name); await x.app.autosave(); }
    const slot = key => JSON.parse(x.store.get(PREFIX + key)).name;
    assert.equal(slot('autosave'), '넷째 저장'); assert.equal(slot('autosave-1'), '셋째 저장'); assert.equal(slot('autosave-2'), '둘째 저장');
    assert.equal(x.app.slots['autosave-2'].name, '둘째 저장');
    await x.app.autosave(); assert.equal(slot('autosave'), '넷째 저장'); assert.equal(slot('autosave-1'), '셋째 저장');
    const y = await make(Object.fromEntries([...x.store]));
    try {
      const dialog = y.app.showRecovery(); await wait();
      const cards = [...y.dom.window.document.querySelectorAll('.modal .card h3')].map(e => e.textContent);
      assert.deepEqual(cards, ['자동 저장 · 최근', '자동 저장 · 1회 전', '자동 저장 · 2회 전', '수동 임시 저장']);
      y.dom.window.document.querySelectorAll('.modal .card button')[2].click(); await dialog;
      assert.equal(y.app.s.draft.name, '둘째 저장');
    } finally { y.close(); }
  } finally { x.close(); }
});

test('applied proposal can be undone once until the draft changes again', async () => {
  const x = await make(); try {
    x.app.task = 'description'; x.app.s.requests.description = '수정'; x.app.s.draft.desc = 'same same'; x.app.touch();
    x.app.api.runLLMModel = async () => ({ type: 'success', result: JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: 'rewritten' } }) });
    await x.app.sendRequest(); const candidate = x.app.s.candidates[0]; assert.ok(candidate);
    const revision = x.app.s.revision;
    await x.app.applyCandidate(candidate); assert.equal(x.app.s.draft.desc, 'rewritten'); assert.equal(candidate.status, 'applied');
    const undo = x.dom.window.document.querySelector('[data-action="undo-candidate"]'); assert.ok(undo);
    undo.click(); await wait();
    assert.equal(x.app.s.draft.desc, 'same same'); assert.equal(candidate.status, undefined); assert.equal(x.app.s.revision, revision);
    assert.ok(x.app.candidateValid(candidate)); assert.equal(x.dom.window.document.querySelector('[data-action="undo-candidate"]'), null);
    await x.app.applyCandidate(candidate); assert.equal(x.app.s.draft.desc, 'rewritten');
    x.app.setField('desc', 'manual'); assert.equal(x.app.undoAvailable(), false);
    assert.equal(x.dom.window.document.querySelector('.undo-bar').hidden, true, 'undo bar hides as soon as the draft is edited');
    x.app.render(); assert.equal(x.dom.window.document.querySelector('[data-action="undo-candidate"]'), null);
    assert.throws(() => x.app.undoApplied(), /되돌릴 수 없습니다/);
  } finally { x.close(); }
});

test('sidebar marks tabs whose fields differ from the loaded character or blank draft', async () => {
  const x = await make(); try {
    const changed = () => [...x.dom.window.document.querySelectorAll('.navitem[data-changed="true"]')].map(e => e.dataset.tab);
    assert.deepEqual(changed(), []);
    x.app.setField('desc', '설명'); assert.deepEqual(changed(), ['description']);
    x.app.s.draft.globalLore = [{ key: 'k', content: 'c', comment: '' }]; x.app.touch(); assert.deepEqual(changed(), ['description', 'lorebook']);
    assert.equal(x.dom.window.document.querySelector('.navitem[data-tab="lorebook"] .navcount').textContent, '1');
    const base = newSession(); base.targetId = 'cha-1'; base.draft.desc = '원본'; base.base = editable(base.draft);
    await x.app.replaceSession(base); assert.deepEqual(changed(), []);
    x.app.setField('firstMessage', '첫 장면'); assert.deepEqual(changed(), ['greeting']);
  } finally { x.close(); }
});

test('conversation labels are Korean', async () => {
  const x = await make(); try {
    x.app.s.requests.workshop = '시작'; await x.app.sendRequest();
    assert.deepEqual([...x.dom.window.document.querySelectorAll('.msglabel')].map(e => e.textContent), ['나', '작성 파트너']);
  } finally { x.close(); }
});

test('mobile shows save status under the title, opens proposal details by default and tracks tab-strip overflow', async () => {
  const x = await make(); try {
    const doc = x.dom.window.document, media = x.dom.window.matchMedia;
    x.dom.window.matchMedia = query => query.includes('max-width') ? { matches: true } : media(query);
    x.app.render();
    assert.equal(doc.querySelector('.mobile-top .mobile-status').textContent, '변경 없음 · 자동 없음 · 임시 없음');
    assert.equal(doc.querySelector('.sidebar').dataset.overflow, 'false');
    x.app.task = 'description'; x.app.s.requests.description = '수정'; x.app.s.draft.desc = 'same'; x.app.touch();
    assert.match(doc.querySelector('.mobile-top .mobile-status').textContent, /^편집 중 · 자동 없음/);
    x.app.api.runLLMModel = async () => ({ type: 'success', result: JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: 'rewritten' } }) });
    await x.app.sendRequest();
    assert.equal(doc.querySelector('.candidate details').open, true, 'mobile proposal details start expanded');
    x.dom.window.matchMedia = media; x.app.render();
    assert.equal(doc.querySelector('.candidate details').open, false, 'desktop proposal details stay collapsed');
  } finally { x.close(); }
});

test('the active request task is shown beside the input, on the mobile settings toggle and on each message', async () => {
  const x = await make(); try {
    const doc = x.dom.window.document;
    assert.equal(doc.querySelector('.mode-strip .mode-pill').textContent, '설계 대화');
    assert.equal(doc.querySelector('.request-settings-toggle').textContent, '설계 대화 ▾');
    x.app.task = 'lorebook'; x.app.s.draft.globalLore = [{ key: 'k', content: 'c', comment: '' }]; x.app.scopeOnly = true; x.app.render();
    assert.equal(doc.querySelector('.mode-strip').dataset.task, 'lorebook');
    assert.equal(doc.querySelector('.mode-strip .mode-pill').textContent, '로어북');
    assert.match(doc.querySelector('.mode-strip .mode-scope').textContent, /로어북 항목을 추가·수정·삭제합니다\. 현재 선택한 항목만 수정합니다\./);
    assert.equal(doc.querySelector('.request-settings-toggle').textContent, '로어북 ▾');
    x.app.task = 'description'; x.app.scopeOnly = false; x.app.s.requests.description = '수정'; x.app.s.draft.desc = 'same'; x.app.touch();
    x.app.api.runLLMModel = async () => ({ type: 'success', result: JSON.stringify({ schemaVersion: 2, task: 'description', data: { text: 'rewritten' } }) });
    await x.app.sendRequest();
    assert.deepEqual([...doc.querySelectorAll('.msglabel')].map(e => e.textContent), ['나캐릭터 설명', '작성 파트너캐릭터 설명']);
    assert.equal(x.app.s.thread.at(-1).task, 'description');
    x.app.task = 'workshop'; x.app.s.requests.workshop = '의논'; x.app.api.runLLMModel = async () => ({ type: 'success', result: JSON.stringify({ schemaVersion: 2, task: 'workshop', data: { reply: '네', changes: [] } }) });
    await x.app.sendRequest();
    assert.equal(doc.querySelectorAll('.msgtask').length, 2, 'workshop messages carry no task tag');
  } finally { x.close(); }
});
