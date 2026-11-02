// SPDX-License-Identifier: GPL-3.0-only
// Workshop UI for Risu/RisuBard-compatible block/toggle data, independent of host UI stores.
import { clone, assert, tick } from './core.js';
import { decodePreset, normalizePreset, PRESET_LIMIT } from './preset-format.js';
import { newPresetState, validatePresetState, toggleDefinitions, BLOCK_TYPES, moduleReferences } from './preset-engine.js';
import { parseV2, compileV2, toggleDefault } from './preset-v2.js';
import { activeModules, presetRegexProfile } from './modules.js';
import { chooseInstalledModules, renderModules, renderRuntimeInspection } from './modules-ui.js';

export async function importPresetFile(app) {
  const file=await app.file('.risup,.risupreset,.json,.preset'); if(!file)return;
  assert(file.size<=PRESET_LIMIT,'프리셋 파일은 32MiB 이하만 지원합니다.');
  const id=app.s.sessionId, data=new Uint8Array(await file.arrayBuffer());
  assert(app.s.sessionId===id,'작업이 바뀌어 프리셋 가져오기를 중단했습니다.');
  await applyImportedPreset(app,data,file.name);
}
export async function applyImportedPreset(app,data,name) {
  const id=app.s.sessionId;
  await tick(); const preset=decodePreset(data,name);
  assert(app.s.sessionId===id,'작업이 바뀌어 프리셋 가져오기를 중단했습니다.');
  const previous=app.s.preset,modules=clone(previous.modules??[]),moduleOptions=clone(previous.moduleOptions??{});
  const values=Object.fromEntries(toggleDefinitions(null,modules).definitions.filter(d=>Object.hasOwn(previous.values,d.key)).map(d=>[d.key,previous.values[d.key]]));
  const next={...newPresetState(),mode:'preset',preset,modules,moduleOptions,values};
  toggleDefinitions(preset,modules);
  app.s.preset=next; app.presetChanged();
  await savePresetWorkspace(app);
  app.s.tab='preset'; app.view='editor'; app.render();
  app.toast('프리셋을 공방으로 가져왔습니다. 토글과 전송 내용을 확인하세요.');
}
export async function savePresetWorkspace(app) {
  const value=validatePresetState(app.s.preset);
  await app.store('preset-workspace',value); app.savedPreset=clone(value);
}
export function selectModules(app) {
  return chooseInstalledModules(app,{references:moduleReferences,save:savePresetWorkspace,validate:state=>{const next=validatePresetState(state);toggleDefinitions(next.preset,activeModules(next));return next;}});
}
function exportJson(app) {
  const data=normalizePreset(app.s.preset.preset);
  assert(!data.promptTemplate.some(b=>b.workshopError),'적용하지 못한 조건 편집을 먼저 수정하세요.');
  data.promptTemplate=data.promptTemplate.filter(b=>b.enabled!==false).map(b=>{delete b.enabled;delete b.workshopError;delete b.workshopDraft;return b;});
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=app.h('a',{href:url,download:(data.name||'preset').replace(/[<>:"/\\|?*]/g,'_')+'.json'});
  app.doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function renderPresetEditor(app,host) {
  const h=app.h.bind(app),state=app.s.preset,p=state.preset;
  const change=()=>app.presetChanged();
  const redraw=()=>app.renderEditor();
  host.append(h('div',{class:'row'},app.b('프리셋 가져오기',()=>importPresetFile(app),'primary',{'data-action':'import-preset'}),app.b('설치 모듈 선택',()=>selectModules(app),'',{'data-action':'select-modules'}),app.b('프리셋 설정 저장',async()=>{await savePresetWorkspace(app);app.toast('프리셋·모듈·토글 설정을 저장했습니다.');}),app.b('JSON 내보내기',()=>exportJson(app),'',{disabled:!p})));
  if(!p) {host.append(h('div',{class:'empty'},'.risup / .risupreset / JSON 파일을 가져오세요.','\n프롬프트와 토글은 공방 안에서 관리하며 본체 프리셋은 변경하지 않습니다.'));if(state.modules?.length)renderModules(app,host);return;}
  host.append(app.field('프리셋 이름',p.name,v=>{p.name=v;change();},{tag:'input'}),h('p',{class:'muted'},'파일에서 가져온 사본입니다. 본체와 자동 동기화하지 않습니다. 모델·접속 정보는 가져오지 않으며 기존 메인·보조 모델 설정을 사용합니다.'),
    h('div',{class:'row'},[['blocks','프롬프트 블록'],['toggles','토글 설정'],['modules','모듈'],['context','참고자료'],['preview','전송 내용']].map(([key,label])=>app.b(label,()=>{state.pane=key;app.touch(false);redraw();},state.pane===key?'primary small':'small'))));
  if(state.pane==='toggles') {
    let tree; try{tree=toggleDefinitions(p,activeModules(state));}catch(error){host.append(h('p',{class:'warn'},error.message));tree={items:[],definitions:[]};}
    const draw=items=>items.map(item=>{
      if(item.type==='group')return h('details',{class:'card',open:''},h('summary',{},item.label||'그룹'),h('div',{class:'stack',style:'margin-top:12px'},draw(item.children)));
      if(item.type==='caption')return h('p',{class:'muted'},item.label);
      if(item.type==='divider')return h('hr',{class:'ruled'});
      const d=item.definition,value=state.values[d.key]??toggleDefault(d);
      let control;
      if(d.type==='switch')control=app.check(d.label,value==='1',v=>{state.values[d.key]=v?'1':'0';change();});
      else if(d.type==='select')control=h('label',{class:'field'},h('span',{},d.label),app.select(value,d.options.map((label,i)=>[String(i),label]),v=>{state.values[d.key]=v;change();},d.label));
      else control=app.field(d.label,value,v=>{state.values[d.key]=v;change();},{tag:d.type==='text'?'input':'textarea'});
      const usages=p.promptTemplate.filter(b=>(b.text??b.innerFormat??'').includes(d.key)).map(b=>b.name||b.type);
      for(const module of activeModules(state))if(module.lorebook.some(l=>l.content.includes(d.key)))usages.push(module.name+' 로어북');
      return h('div',{class:'card stack'},control,h('p',{class:'muted'},d.key+' · 정의: '+d.sources.join(', ')+(usages.length?' · 사용: '+usages.join(', '):' · 참조 블록 없음')));
    });
    host.append(h('p',{class:'muted'},'토글 정의는 파일에서 읽고, 선택값은 공방에 별도로 저장합니다. 선택형 값은 본체와 같이 선택지의 번호(0부터)로 처리합니다.'),...draw(tree.items),
      h('details',{},h('summary',{},'토글 정의 원문 편집'),h('div',{class:'stack'},app.field('토글 정의',p.customPromptTemplateToggle,v=>{p.customPromptTemplateToggle=v;change();},{class:'code',placeholder:'tone=말투=select=차분함,활기참\nextra=추가 설정\nnote=메모=textarea'}),app.b('토글 목록 갱신',()=>{toggleDefinitions(p,activeModules(state));redraw();},'small'))));
  } else if(state.pane==='modules')renderModules(app,host);
  else if(state.pane==='context') {
    const env=state.environment;
    host.append(app.field('사용자 이름',env.userName,v=>{env.userName=v;change();},{tag:'input'}),app.field('페르소나 블록 입력',env.persona,v=>{env.persona=v;change();}),app.field('작가 노트 블록 입력',env.authorNote,v=>{env.authorNote=v;change();}),app.field('메모리 블록 입력 · 본체 메모리와 별도',env.memory,v=>{env.memory=v;change();}),h('p',{class:'muted'},'캐릭터 설명·로어북은 공방 현재안을 사용합니다. 로어북 블록에는 전체 항목을 넣으며 본체의 활성화 조건·메모리 검색은 실행하지 않습니다.'));
    let globals=JSON.stringify(env.globals,null,2);
    host.append(app.field('추가 전역 변수 JSON · 문자열 값',globals,v=>globals=v,{class:'code'}),app.b('추가 변수 적용',()=>{const values=JSON.parse(globals);validatePresetState({...state,environment:{...env,globals:values}});env.globals=values;change();app.toast('추가 변수를 적용했습니다.');},'small'));
    if(moduleReferences(p).length)host.append(h('p',{class:'muted'},'모듈 참조: '+moduleReferences(p).join(', ')+' · 설치 모듈 선택에서 일치하는 ID·namespace를 선택하세요.'),app.check('모듈 연동 전체 제외',state.excluded.modules,v=>{state.excluded.modules=v;change();}),h('p',{class:'muted'},'전체 제외를 선택하면 선택한 모듈의 로어북·토글도 요청에 적용하지 않습니다.'));
    if(p.regex?.length) {
      const profile=presetRegexProfile(p.regex);
      if(profile.notApplicable.length)host.append(h('p',{class:'muted'},'프리셋에서 BB 단계에 적용하지 않는 항목: '+profile.notApplicable.join(', ')));
      if(profile.blocking.length)host.append(h('p',{class:'warn'},'프리셋의 요청 관련 미지원 항목: '+profile.blocking.join(', ')),app.check('프리셋 정규식을 제외하고 사용',state.excluded.regex,v=>{state.excluded.regex=v;change();}));
      renderRuntimeInspection(app,host,profile,item=>p.regex[item.index],'프리셋 정규식 처리 내역과 원문 확인');
    }
    if(p.promptBlockOverlay?.enabled)host.append(app.check('보조 프롬프트 오버레이를 제외하고 사용',state.excluded.overlay,v=>{state.excluded.overlay=v;change();}));
    if(p.promptTemplate.some(b=>b.type==='jailbreak'))host.append(app.check('구형 추가 프롬프트 블록 사용',p.jailbreakToggle!==false,v=>{p.jailbreakToggle=v;change();}));
    if(p.promptTemplate.some(b=>b.type==='cot'))host.append(app.check('구형 CoT 블록 사용',p.chainOfThought!==false,v=>{p.chainOfThought=v;change();}));
    host.append(h('details',{},h('summary',{},'프롬프트 옵션 JSON'),h('div',{class:'stack'},app.field('프롬프트 옵션',JSON.stringify(p.promptSettings??{},null,2),v=>state.optionDraft=v,{class:'code'}),app.b('옵션 적용',()=>{const value=JSON.parse(state.optionDraft??JSON.stringify(p.promptSettings??{}));assert(value&&typeof value==='object'&&!Array.isArray(value),'옵션은 JSON 객체여야 합니다.');p.promptSettings=value;change();app.toast('옵션을 적용했습니다.');},'small'))));
  } else if(state.pane==='preview') {
    const output=h('div',{class:'stack'});
    const preview=()=>{
      try {
        const report=app.previewRequest(app.task);
        output.replaceChildren(report.issues.length?h('div',{class:'warn'},'전송할 수 없는 항목: ',h('ul',{},report.issues.map(x=>h('li',{},x)))):h('p',{class:'pill'},'조립 검사 통과 · '+report.messages.length+'개 메시지'),
          h('p',{class:'muted'},'현재 요청: '+app.task+' · '+(state.mode==='preset'?'프리셋 요청':'직접 요청')+' · '+report.messages.reduce((n,m)=>n+m.content.length,0).toLocaleString()+'자'),
          h('details',{},h('summary',{},'블록별 포함·제외 결과'),h('pre',{class:'diff'},JSON.stringify(report.trace,null,2))),
          h('details',{},h('summary',{},'모듈별 포함·제외 결과'),h('pre',{class:'diff'},JSON.stringify(report.moduleTrace??[],null,2))),
          h('details',{},h('summary',{},'프리셋 정규식 처리 결과'),h('pre',{class:'diff'},JSON.stringify(report.presetRegexTrace??[],null,2))),
          ...report.messages.map((m,i)=>h('details',{class:'card preview-message',open:''},h('summary',{},`${i+1}. ${m.role} · ${m.content.length.toLocaleString()}자`+(m.cachePoint?' · 캐시 지점':'')),h('pre',{class:'diff'},m.content))),
          h('p',{class:'muted'},report.notes.join('\n')));
      }catch(error){output.replaceChildren(h('p',{class:'warn'},error.message));}
    };
    host.append(app.b('현재 원고·토글로 다시 조립',preview,'small'),output);preview();
  } else renderBlocks(app,host);
}
function renderBlocks(app,host) {
  const h=app.h.bind(app),state=app.s.preset,list=state.preset.promptTemplate;
  const change=()=>app.presetChanged(),redraw=()=>app.renderEditor();
  let addType='plain';
  host.append(h('div',{class:'row'},h('div',{class:'fill'},app.select('plain',BLOCK_TYPES,v=>addType=v,'추가할 블록 유형')),app.b('블록 추가',()=>{
    const b={type:addType,name:BLOCK_TYPES.find(([key])=>key===addType)?.[1]??addType};
    if(['plain','jailbreak','cot','chatML'].includes(addType))Object.assign(b,{text:'',role:'system',type2:'normal'});
    if(addType==='chat')Object.assign(b,{rangeStart:0,rangeEnd:'end'});
    if(addType==='cache')Object.assign(b,{depth:1,role:'all'});
    list.push(b);state.selected=list.length-1;change();redraw();
  },'small')));
  const i=Math.min(Math.max(Number(state.selected)||0,0),Math.max(0,list.length-1));state.selected=i;
  const nav=h('div',{class:'itemlist preset-block-list'},list.map((b,index)=>app.b((b.enabled===false?'○ ':'● ')+(index+1)+'. '+(b.name||b.type),()=>{state.selected=index;app.touch(false);redraw();},'listitem'+(i===index?' active':''))));
  const edit=h('div',{class:'stack'}),pane=h('div',{class:'list-editor','data-list':'preset'},nav,app.listSplitter(),edit);
  host.append(h('div',{class:'row'},h('span',{class:'muted'},list.length+'개 블록'),app.listCollapseButton('preset',pane)),pane);
  const b=list[i];if(!b){edit.append(h('div',{class:'empty'},'블록을 추가하세요. 이번 요청을 포함하는 제작 대화 블록이 필요합니다.'));return;}
  edit.append(app.field('블록 이름',b.name??'',v=>{b.name=v;change();},{tag:'input'}),h('div',{class:'row'},app.check('이 블록 사용',b.enabled!==false,v=>{b.enabled=v;change();}),h('span',{class:'pill'},b.type)));
  const move=delta=>{if(i+delta<0||i+delta>=list.length)return;[list[i],list[i+delta]]=[list[i+delta],list[i]];state.selected+=delta;change();redraw();};
  edit.append(h('div',{class:'row'},app.b('위로',()=>move(-1),'small'),app.b('아래로',()=>move(1),'small'),app.b('복제',()=>{list.splice(i+1,0,clone(b));state.selected++;change();redraw();},'small'),app.b('블록 삭제',async()=>{if(await app.confirm('블록을 삭제할까요?',b.name||b.type)){list.splice(i,1);change();redraw();}},'small danger')));
  if(b.type==='chat') {
    edit.append(app.field('대화 시작 번호 · 음수는 뒤에서',b.rangeStart??0,v=>{b.rangeStart=Number(v);change();},{tag:'input',type:'number'}),app.field('대화 끝 번호 · end는 끝까지',b.rangeEnd??'end',v=>{b.rangeEnd=v==='end'?'end':Number(v);change();},{tag:'input'}),h('p',{class:'muted'},'공방 제작 대화 뒤에 이번 요청을 사용자 메시지로 넣습니다. 이번 요청이 전체 블록에서 정확히 한 번 포함돼야 전송할 수 있습니다.'));
  } else if(b.type==='cache') {
    edit.append(app.field('캐시 깊이 · 앞선 메시지 개수',b.depth??1,v=>{b.depth=Number(v);change();},{tag:'input',type:'number',min:0,max:3000}),h('label',{class:'field'},h('span',{},'캐시 대상 역할'),app.select(b.role??'all',[['all','전체'],['system','system'],['user','user'],['assistant','assistant']],v=>{b.role=v;change();},'캐시 대상 역할')),h('p',{class:'muted'},'이 블록 앞의 대상 메시지에 cachePoint를 표시합니다. 프롬프트 텍스트는 추가하지 않으며, 실제 캐시는 본체와 모델 제공자 설정을 따릅니다.'));
  } else if(['plain','jailbreak','cot','chatML'].includes(b.type)) {
    if(b.type!=='chatML')edit.append(h('label',{class:'field'},h('span',{},'역할'),app.select(b.role??'system',[['system','system'],['user','user'],['bot','assistant']],v=>{b.role=v;change();},'블록 역할')));
    renderText(app,edit,b,'text');
  } else if(['description','persona','authornote','memory','lorebook','postEverything'].includes(b.type)) {
    edit.append(h('label',{class:'field'},h('span',{},'역할'),app.select(b.role2??'system',[['system','system'],['user','user'],['bot','assistant']],v=>{b.role2=v;change();},'블록 역할')));
    edit.append(h('p',{class:'muted'},b.type==='lorebook'?'공방 현재안의 전체 로어북을 사용합니다.':b.type==='postEverything'?'프롬프트 옵션의 postEndInnerFormat을 사용합니다.':'공방의 해당 참고자료를 넣습니다.'),h('p',{class:'muted'},'감싸는 서식을 사용할 때 내용 위치는 {{slot}}으로 표시하세요.'));
    renderText(app,edit,b,'innerFormat');
    if(b.type==='authornote')edit.append(app.field('기본 작가 노트',b.defaultText??'',v=>{b.defaultText=v;change();}));
  } else edit.append(h('p',{class:'warn'},'이 블록은 아직 지원하지 않습니다. 사용을 끄거나 다른 블록으로 교체하세요.'));
}
function renderText(app,host,block,key) {
  const h=app.h.bind(app),parsed=block.workshopDraft?.key===key?clone(block.workshopDraft):parseV2(block[key]??'');
  const errorText=h('p',{class:'warn'},block.workshopError??'');
  let source=block[key]??'',rawInput;
  const commit=()=>{try{block[key]=compileV2(parsed.body,parsed.activation);delete block.workshopError;delete block.workshopDraft;source=block[key];if(rawInput)rawInput.value=source;}catch(error){block.workshopError=error.message;block.workshopDraft={key,body:parsed.body,activation:clone(parsed.activation)};}errorText.textContent=block.workshopError??'';app.presetChanged();};
  const body=app.field(key==='text'?'블록 본문':'감싸는 서식',parsed.body,v=>{parsed.body=v;commit();},{class:'code',style:'min-height:240px'});
  host.append(body,errorText);
  const box=h('div',{class:'stack'});
  const draw=()=>{
    box.replaceChildren(h('h3',{},'v2 활성화 조건'));
    if(parsed.activation) {
      box.append(app.select(parsed.activation.join,[['and','모두 충족 (AND)'],['or','하나 이상 충족 (OR)']],v=>{parsed.activation.join=v;commit();},'조건 결합'));
      for(const [i,c] of parsed.activation.conditions.entries())box.append(h('div',{class:'card stack'},app.field('조건 변수 키',c.key,v=>{c.key=v;try{commit();}catch(error){app.toast(error.message,true);}},{tag:'input'}),app.select(c.operator,[['is','같음'],['isnot','다름'],['greater','초과'],['greaterequal','이상'],['less','미만'],['lessequal','이하']],v=>{c.operator=v;commit();},'조건 비교'),app.field('비교 값',c.value,v=>{c.value=v;try{commit();}catch(error){app.toast(error.message,true);}},{tag:'input'}),app.b('조건 삭제',()=>{parsed.activation.conditions.splice(i,1);if(!parsed.activation.conditions.length)parsed.activation=null;commit();draw();},'small danger')));
    }
    box.append(app.b('조건 추가',()=>{parsed.activation??={join:'and',conditions:[]};const defs=toggleDefinitions(app.s.preset.preset,activeModules(app.s.preset)).definitions;parsed.activation.conditions.push({key:defs[0]?.key??'toggle_example',operator:'is',value:'1'});commit();draw();},'small'));
  };draw();host.append(box);
  const raw=app.field('전체 CBS 원문',source,v=>source=v,{class:'code'});rawInput=raw.querySelector('textarea');
  host.append(h('details',{},h('summary',{},'전체 CBS 원문 편집'),h('div',{class:'stack'},raw,app.b('원문 적용',()=>{block[key]=source;delete block.workshopError;delete block.workshopDraft;app.presetChanged();app.renderEditor();},'small'))));
}
