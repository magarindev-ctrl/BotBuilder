// SPDX-License-Identifier: GPL-3.0-only
import { assert } from './core.js';
import { readInstalledModules, selectInstalledModules, moduleMatches, moduleRuntimeProfile } from './modules.js';

export async function chooseInstalledModules(app,{references,validate,save}) {
  const session=app.s.sessionId,catalog=await readInstalledModules(app.api);
  assert(app.s.sessionId===session,'작업이 바뀌어 모듈 조회를 중단했습니다.');
  const selected=new Set((app.s.preset.modules??[]).filter(m=>catalog.some(item=>item.id===m.id)).map(m=>m.id));let query='';
  const refs=references(app.s.preset.preset);
  const accepted=await app.dialog('설치 모듈 선택',body=>{
    const h=app.h.bind(app),results=h('div',{class:'stack'}),count=h('p',{class:'muted'});
    const draw=()=>{
      count.textContent=`설치 ${catalog.length}개 · 선택 ${selected.size}개`;
      results.replaceChildren(...catalog.filter(m=>[m.name,m.id,m.namespace].join(' ').toLowerCase().includes(query.toLowerCase())).map(m=>h('div',{class:'card stack',style:'overflow-wrap:anywhere'},app.check((m.name||m.id)+' · '+m.id,selected.has(m.id),checked=>{checked?selected.add(m.id):selected.delete(m.id);count.textContent=`설치 ${catalog.length}개 · 선택 ${selected.size}개`;}),h('p',{class:'muted'},(m.namespace?'namespace: '+m.namespace+' · ':'')+'로어북 '+(m.lorebook?.length??0)+'개 · '+(refs.some(ref=>moduleMatches(m,ref))?'프리셋 참조 모듈':'추가 선택 가능')))));
    };
    body.append(h('p',{class:'muted'},'리스에 설치된 모듈을 조회해 선택 시점의 사본을 가져옵니다. 본체의 활성화·캐릭터·모듈 내용은 변경하지 않습니다.'),app.field('설치 모듈 검색','',value=>{query=value;draw();},{tag:'input'}),h('div',{class:'row'},app.b('프리셋 참조 모듈 선택',()=>{for(const m of catalog)if(refs.some(ref=>moduleMatches(m,ref)))selected.add(m.id);draw();},'small'),app.b('모두 선택 해제',()=>{selected.clear();draw();},'small')),count,results);
    if(!catalog.length)body.append(h('p',{class:'empty'},'리스에 설치된 모듈이 없습니다. 본체에서 먼저 설치한 뒤 다시 조회하세요.'));
    const removed=(app.s.preset.modules??[]).filter(m=>!catalog.some(item=>item.id===m.id));
    if(removed.length)body.append(h('p',{class:'warn'},'기존 사본 중 현재 설치 목록에 없는 모듈: '+removed.map(m=>m.name).join(', ')+'. 선택을 적용하면 이 사본은 제거됩니다.'));
    const missing=refs.filter(ref=>!catalog.some(m=>moduleMatches(m,ref)));
    if(missing.length)body.append(h('p',{class:'warn'},'설치 목록에 없는 프리셋 참조: '+missing.join(', ')));
    draw();
  },[{label:'취소',value:false},{label:'선택 모듈 적용',value:true,kind:'primary'}]);
  if(!accepted)return;
  assert(app.s.sessionId===session,'작업이 바뀌어 모듈 선택을 적용하지 않았습니다.');
  const next=validate(selectInstalledModules(app.s.preset,catalog,[...selected]));
  app.s.preset=next;app.presetChanged();
  app.s.tab='preset';app.s.preset.pane='modules';app.view='editor';app.render();await save(app);
  app.toast('설치 모듈 '+next.modules.length+'개를 가져왔습니다. 적용 항목과 전송 내용을 확인하세요.');
}
export function renderModules(app,host) {
  const h=app.h.bind(app),state=app.s.preset,modules=state.modules??[];
  const change=()=>app.presetChanged();
  host.append(h('p',{class:'muted'},'선택한 모듈의 로어북과 토글을 프리셋 요청에 연결합니다. 로어북은 전체 제작 자료로 취급하며 본체의 키워드 활성화·토큰 예산은 계산하지 않습니다. @@ 위치·활성화 지시나 해석하지 못하는 CBS가 있는 항목은 기본적으로 전송을 막으며, 모듈별 "해석 못 하는 조건은 거짓으로 보고 본문만 포함"을 켜면 본문을 살려 넣습니다. 직접 요청 모드에는 적용하지 않습니다.'),app.check('모듈 연동 전체 제외',!!state.excluded.modules,value=>{state.excluded.modules=value;change();}));
  if(!modules.length){host.append(h('p',{class:'empty'},'설치 모듈 선택 버튼에서 사용할 모듈을 선택하세요.'));return;}
  host.append(h('p',{class:'muted'},'선택 시점의 사본입니다. 본체에서 모듈을 수정했다면 설치 모듈 선택에서 다시 적용하세요. 바뀐 모듈의 제외 설정은 초기화됩니다.'));
  for(const module of modules) {
    const option=state.moduleOptions[module.id]??={skipRuntime:false,excludedLore:[],relaxConditions:false},profile=moduleRuntimeProfile(module),features=profile.blocking;
    // Each module folds to one line so a long list of modules stays scannable; the fold state lives only in this screen.
    const body=h('div',{class:'stack',style:'margin-top:12px'},h('p',{class:'muted'},module.id+(module.namespace?' · '+module.namespace:'')),h('p',{},module.description),h('p',{class:'muted'},'로어북 '+module.lorebook.length+'개 · 토글 정의 '+(module.customModuleToggle?'있음':'없음')+' · 에셋 이름 '+module.assets.length+'개'));
    const card=h('details',{class:'card module-card',style:'overflow-wrap:anywhere',...app.moduleFolded.has(module.id)?{}:{open:''}},h('summary',{},h('h3',{style:'display:inline'},module.name),h('span',{class:'muted'},' · 로어북 '+module.lorebook.length+'개')),body);
    card.addEventListener('toggle',()=>{card.open?app.moduleFolded.delete(module.id):app.moduleFolded.add(module.id);});
    if(profile.notApplicable.length)body.append(h('p',{class:'muted'},'BB 요청 단계에 적용하지 않는 항목: '+profile.notApplicable.join(', ')+'. 출력·표시 후처리는 구조화된 수정안에 적용하지 않으며, 배경 코드와 일반 수동·표시·출력 트리거도 실행하지 않습니다.'));
    if(features.length)body.append(h('p',{class:'warn'},'요청 관련 미지원 항목: '+features.join(', ')),app.check('이 모듈의 요청 관련 미지원 처리를 제외',option.skipRuntime,value=>{option.skipRuntime=value;change();}),h('p',{class:'muted'},'입력·전처리·요청 처리와 Lua·JS 콜백은 요청 내용을 바꿀 수 있습니다. 제외하면 해당 처리를 실행하지 않고 로어북·토글만 사용합니다.'));
    renderRuntimeInspection(app,body,profile,item=>item.kind==='regex'?module.regex[item.index]:item.kind==='trigger'?module.trigger[item.index]:item.kind==='background'?module.backgroundEmbedding:item.kind==='cjs'?module.cjs:module.mcp,'정규식·트리거 처리 내역과 원문 확인');
    body.append(app.check('해석 못 하는 조건은 거짓으로 보고 본문만 포함',option.relaxConditions===true,value=>{option.relaxConditions=value;change();}),h('p',{class:'muted'},'켜면 @@ 위치·활성화 지시 줄은 빼고, 봇빌더가 해석하지 못하는 CBS 조건은 거짓 분기로, 본문 안의 해석 못 하는 표기는 빈 값으로 처리해 항목을 버리지 않고 넣습니다. 토글 조건은 토글 설정 값을 그대로 따릅니다. 그렇게 처리된 항목은 전송 내용의 모듈별 결과에 relaxed로 남습니다.'));
    const details=h('details',{},h('summary',{},'모듈 로어북 포함 항목 확인'));
    for(const [i,entry] of module.lorebook.entries())details.append(h('div',{class:'card stack'},app.check((i+1)+'. '+(entry.comment||entry.key||'로어북'),!option.excludedLore.includes(i),value=>{option.excludedLore=option.excludedLore.filter(index=>index!==i);if(!value)option.excludedLore.push(i);change();}),h('pre',{class:'diff'},entry.content)));
    body.append(details);host.append(card);
  }
}
export function renderRuntimeInspection(app,host,profile,getRaw,title) {
  if(!profile.items.length)return;
  const h=app.h.bind(app),inspection=h('details',{},h('summary',{},title));
  for(const item of profile.items) {
    const raw=getRaw(item);
    inspection.append(h('details',{class:'card'},h('summary',{},item.name+' · '+item.phase+' · '+(item.status==='unsupported'?'미지원 처리':'BB 단계에 미적용')),h('p',{class:'muted'},item.reason),h('pre',{class:'diff'},typeof raw==='string'?raw:JSON.stringify(raw,null,2))));
  }
  host.append(inspection);
}
