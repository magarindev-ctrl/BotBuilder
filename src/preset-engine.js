// SPDX-License-Identifier: GPL-3.0-only
// Independent preset assembly for the workshop. Never reads or mutates host chat state.
import { assert, clone, bytes, parseVariables } from './core.js';
import { normalizePreset, PRESET_LIMIT } from './preset-format.js';
import { parseToggleTree, toggleDefault } from './preset-v2.js';

export function newPresetState() {
  return { schemaVersion: 1, mode: 'direct', preset: null, values: {}, selected: 0, pane: 'blocks', environment: { userName: '사용자', persona: '', authorNote: '', memory: '', globals: {} }, excluded: { regex: false, modules: false, overlay: false } };
}
export function validatePresetState(raw) {
  assert(raw?.schemaVersion === 1 && ['direct','preset'].includes(raw.mode), '지원하지 않는 공방 프리셋 설정입니다.');
  const result = { ...newPresetState(), ...clone(raw) };
  if (result.preset) result.preset = normalizePreset(result.preset);
  assert(result.values && typeof result.values === 'object' && !Array.isArray(result.values), '토글 값 형식이 올바르지 않습니다.');
  result.environment = { ...newPresetState().environment, ...result.environment };
  for (const key of ['userName','persona','authorNote','memory']) assert(typeof result.environment[key] === 'string', '프리셋 참고자료 형식 오류: ' + key);
  assert(result.environment.globals && typeof result.environment.globals === 'object' && !Array.isArray(result.environment.globals), '추가 전역 변수는 JSON 객체여야 합니다.');
  for (const values of [result.values,result.environment.globals]) for (const [key,value] of Object.entries(values)) {
    assert(!['__proto__','constructor','prototype'].includes(key) && typeof value === 'string', '변수의 키·값이 올바르지 않습니다.');
  }
  result.excluded = { ...newPresetState().excluded, ...result.excluded };
  for(const key of ['regex','modules','overlay'])assert(typeof result.excluded[key]==='boolean','제외 설정은 참/거짓이어야 합니다: '+key);
  assert(bytes(JSON.stringify(result)) <= PRESET_LIMIT * 2, '프리셋 작업 상태가 너무 큽니다.');
  return result;
}
export function toggleDefinitions(preset) {
  const tree = parseToggleTree(preset?.customPromptTemplateToggle ?? '');
  assert(tree.definitions.length <= 300, '토글은 300개 이하만 지원합니다.');
  const names = new Set();
  for (const d of tree.definitions) {
    assert(!names.has(d.key), '중복 토글 키: ' + d.rawKey); names.add(d.key);
    assert(!/[{}\r\n]/.test(d.key) && !d.key.includes('::'), '토글 키에 중괄호·줄바꿈·::를 사용할 수 없습니다.');
  }
  return tree;
}
export function presetValues(state) {
  const r = { ...state.environment.globals };
  for (const d of toggleDefinitions(state.preset).definitions) {
    const value = state.values[d.key] ?? toggleDefault(d);
    if (d.type === 'switch') assert(['0','1'].includes(value), '스위치 토글 값은 0/1이어야 합니다: ' + d.rawKey);
    if (d.type === 'select') assert(/^\d+$/.test(value) && Number(value) < d.options.length, '선택형 토글 값이 올바르지 않습니다: ' + d.rawKey);
    r[d.key] = value;
  }
  return r;
}

// Parse CBS into a bounded tree. Context values are returned as opaque strings;
// imported prompt syntax never reinterprets character code or the user's request.
function tokenize(source) {
  assert(source.length <= 1048576, '블록 원문이 1MiB를 초과했습니다.');
  let position = 0, count = 0;
  function pieces(depth, inMacro) {
    assert(depth < 50, 'CBS 중첩이 너무 깊습니다.');
    const parts = [[]]; let text = '';
    const flush = () => { if (text) { parts.at(-1).push({ kind:'text', text }); text=''; } };
    while (position < source.length) {
      assert(++count < 2000000, 'CBS 처리 한도에 도달했습니다.');
      if (source.startsWith('{{',position)) {
        flush(); position+=2; const nested=pieces(depth+1,true); parts.at(-1).push({kind:'macro',parts:nested});
      } else if (inMacro && source.startsWith('}}',position)) { flush(); position+=2; return parts; }
      else if (inMacro && source.startsWith('::',position)) { flush(); parts.push([]); position+=2; }
      else { text+=source[position++]; }
    }
    flush(); assert(!inMacro,'CBS 닫는 중괄호가 없습니다.'); return parts;
  }
  const nodes=pieces(0,false)[0]; let cursor=0;
  function group(closing,depth=0) {
    assert(depth<50,'CBS 블록 중첩이 너무 깊습니다.');
    const children=[];
    while(cursor<nodes.length) {
      const node=nodes[cursor++], head=node.kind==='macro'?(node.parts[0][0]?.text??'').trim():'';
      if(head==='else' || head==='#else') { assert(closing,'단독 else 문입니다.'); return {children,otherwise:true}; }
      if(head.startsWith('/') && !head.startsWith('//')) { assert(head.slice(1)===closing,'CBS 블록의 닫는 태그가 일치하지 않습니다.'); return {children,otherwise:false}; }
      if(head.startsWith('#')) {
        const name=head.split(/\s/)[0].slice(1), first=group(name,depth+1);
        const second=first.otherwise?group(name,depth+1):{children:[]};
        children.push({kind:'block',name,opening:node,yes:first.children,no:second.children});
      } else children.push(node);
    }
    assert(!closing,'CBS 블록 닫는 태그가 없습니다: '+closing); return {children};
  }
  return group(null).children;
}
const truth = value => !['','0','false','null','undefined','NaN'].includes(String(value).trim());
function logic(values) {
  if(values.length===1)return truth(values[0]);
  assert(values.length%2===1,'조건식의 값과 and/or 수가 맞지 않습니다.');
  const joins=values.filter((_,i)=>i%2===1);
  assert(joins.every(v=>v==='and'||v==='or') && joins.every(v=>v===joins[0]),'혼합 조건식은 and 또는 or로 나눠 중첩해 주세요.');
  const flags=values.filter((_,i)=>i%2===0).map(truth);
  return joins[0]==='or'?flags.some(Boolean):flags.every(Boolean);
}
function evaluate(nodes, context) {
  const render = list => {
    let out='';
    for(const node of list) { out+=one(node); assert(out.length<=2097152,'CBS 출력 상한을 초과했습니다.'); }
    return out;
  };
  const part = p => render(p);
  function one(node) {
    if(node.kind==='text')return node.text;
    if(node.kind==='block') {
      assert(['if','if_pure','when'].includes(node.name),'지원하지 않는 CBS 블록: #'+node.name);
      let values;
      if(node.name==='when') { values=node.opening.parts.slice(1).map(part); if(values[0]==='keep')values.shift(); }
      else values=[part(node.opening.parts[0]).replace(/^#if(?:_pure)?\s*/,'')];
      return render(logic(values)?node.yes:node.no);
    }
    const head=part(node.parts[0]).trim(), name=head.toLowerCase(), args=node.parts.slice(1).map(part);
    if(head.startsWith('//') || head.startsWith('!'))return '';
    if(Object.hasOwn(context.fields,name)) { assert(!args.length,'인자 없는 CBS 표기입니다: '+head); return context.fields[name]; }
    if(name==='getglobalvar') { assert(args.length===1,'getglobalvar 인자 오류'); assert(Object.hasOwn(context.globals,args[0]),'값이 없는 전역 변수: '+args[0]+' (토글 또는 추가 전역 변수에서 설정하세요)'); return context.globals[args[0]]; }
    if(name==='getvar') { assert(args.length===1,'getvar 인자 오류'); return Object.hasOwn(context.variables,args[0])?context.variables[args[0]]:'null'; }
    if(['equal','notequal','greater','greater_equal','less','less_equal'].includes(name)) {
      assert(args.length===2,'비교식에는 값 2개가 필요합니다: '+name);
      const [a,b]=args;
      if(name==='equal')return a===b?'1':'0'; if(name==='notequal')return a!==b?'1':'0';
      const x=Number(a),y=Number(b); assert(Number.isFinite(x)&&Number.isFinite(y),'숫자 비교에 숫자가 아닌 값이 있습니다.');
      return ({greater:x>y,greater_equal:x>=y,less:x<y,less_equal:x<=y})[name]?'1':'0';
    }
    if(name==='and')return args.every(truth)?'1':'0';
    if(name==='or')return args.some(truth)?'1':'0';
    if(name==='not') { assert(args.length===1,'not 인자 오류'); return truth(args[0])?'0':'1'; }
    if(name==='trim') { if(args.length)return args.join('::').trim(); context.trim=true; return ''; }
    if(name==='lower')return args.join('::').toLowerCase();
    if(name==='upper')return args.join('::').toUpperCase();
    throw new Error('지원하지 않는 CBS: '+head);
  }
  const out=render(nodes); return context.trim?out.trim():out;
}
export function renderPresetText(source, context) {
  const value=evaluate(tokenize(source),{...context,trim:false});
  assert(bytes(value)<=2097152,'CBS 출력이 2MiB를 초과했습니다.'); return value;
}
function range(block,count) {
  let start=block.rangeStart??0,end=block.rangeEnd??'end';
  assert(Number.isInteger(start) && (end==='end'||Number.isInteger(end)),'채팅 범위가 올바르지 않습니다.');
  if(start===-1000)return [0,count];
  if(end==='end')end=count;
  if(start<0)start=Math.max(0,count+start); if(end<0)end=Math.max(0,count+end);
  return [start,Math.min(end,count)];
}
const roles={system:'system',user:'user',bot:'assistant',assistant:'assistant'};
const role = value => Object.hasOwn(roles,value)?roles[value]:undefined;
export const BLOCK_TYPES = [['plain','일반 프롬프트'],['chat','제작 대화'],['description','캐릭터 설명'],['persona','페르소나'],['lorebook','로어북'],['authornote','작가 노트'],['postEverything','마지막 지시'],['memory','메모리 입력'],['chatML','ChatML'],['jailbreak','구형 추가 프롬프트'],['cot','구형 CoT 블록'],['cache','캐시 지점 (미지원)']];
export function assemblePreset(rawState,session,task,directMessages) {
  const state=validatePresetState(rawState), p=state.preset;
  assert(p,'먼저 프리셋 파일을 가져오세요.');
  const globals=presetValues(state), variables={...parseVariables(p.templateDefaultVariables),...parseVariables(session.draft.defaultVariables??'')};
  const d=session.draft, env=state.environment;
  const lore=(d.globalLore??[]).map(l=>'['+(l.comment||l.key)+']\n'+l.content).join('\n\n');
  const currentUser={role:'user',content:'[공방 작업 지침]\n'+directMessages[0].content+'\n\n'+directMessages[1].content};
  const history=session.thread.filter(m=>!m.error&&['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:m.content}));
  const chats=[...history,currentUser];
  const context={globals,variables,fields:{char:d.name??'',user:env.userName,description:d.desc??'',personality:d.personality??'',scenario:d.scenario??'',persona:env.persona,firstmessage:d.firstMessage??'',first_message:d.firstMessage??'',systemprompt:d.systemPrompt??'',lorebook:lore,chatindex:String(chats.length-1),lastusermessage:currentUser.content,lastcharmessage:history.findLast(m=>m.role==='assistant')?.content??'',original:p.mainPrompt,slot:''}};
  const messages=[], trace=[], issues=[]; let userCount=0;
  if(p.moduleIntergration&&!state.excluded.modules)issues.push('외부 모듈 참조는 가져온 파일만으로 재현할 수 없습니다. 제외 여부를 설정하세요.');
  if(p.regex?.length&&!state.excluded.regex)issues.push('프리셋 정규식 파이프라인은 미지원입니다. 제외 여부를 설정하세요.');
  if(p.promptBlockOverlay?.enabled&&!state.excluded.overlay)issues.push('보조 프롬프트 오버레이는 미지원입니다. 제외 여부를 설정하세요.');
  for(const option of ['sendChatAsSystem','sendName','utilOverride','customChainOfThought']) if(p.promptSettings?.[option])issues.push('미지원 프롬프트 옵션: '+option+' (고급 JSON에서 해제하세요)');
  let size=0;
  const push=(r,content,blockIndex,current=false)=>{
    assert(role(r),'지원하지 않는 메시지 역할: '+r);
    size+=bytes(content);assert(size<=4*1024*1024,'조립된 프롬프트가 4MiB 상한을 초과했습니다.');
    if(current)userCount++;
    if(content)messages.push({role:role(r),content});
    assert(messages.length<=3000,'전송 메시지가 3,000개를 초과했습니다.');
  };
  for(const [i,b] of p.promptTemplate.entries()) {
    const record={index:i,name:b.name||b.type,type:b.type,status:'excluded',messages:0}; trace.push(record);
    if(b.enabled===false)continue;
    if((b.type==='jailbreak'&&p.jailbreakToggle===false)||(b.type==='cot'&&p.chainOfThought===false)){record.reason='프리셋의 구형 블록 활성화 설정이 꺼져 있습니다.';continue;}
    const before=messages.length;
    try {
      assert(!b.workshopError,b.workshopError);
      if(['plain','jailbreak','cot'].includes(b.type)) push(b.role??'system',renderPresetText(b.text??'',context),i);
      else if(b.type==='chat') {
        const [start,end]=range(b,chats.length);
        for(const m of chats.slice(start,Math.max(start,end)))push(m.role,m.content,i,m===currentUser);
      } else if(['description','persona','lorebook','authornote','memory','postEverything'].includes(b.type)) {
        const values={description:d.desc??'',persona:env.persona,lorebook:lore,authornote:env.authorNote||b.defaultText||'',memory:env.memory,postEverything:p.promptSettings?.postEndInnerFormat??''};
        let text=values[b.type];
        if(text && (b.type==='postEverything'||(b.type==='authornote'&&!env.authorNote)))text=renderPresetText(text,context);
        if(text && b.innerFormat) { assert(b.innerFormat.includes('{{slot}}'),'감싸는 서식에 {{slot}}이 없습니다.'); text=renderPresetText(b.innerFormat,{...context,fields:{...context.fields,slot:text}}); }
        push(b.role2??'system',text,i);
      } else if(b.type==='chatML') {
        const text=renderPresetText(b.text??'',context), regex=/<\|im_start\|>(system|user|assistant)\r?\n([\s\S]*?)(?:<\|im_end\|>|$)/g;
        let match,position=0;
        while((match=regex.exec(text))) { assert(!text.slice(position,match.index).trim(),'ChatML 시작 표기 앞에 해석할 수 없는 내용이 있습니다.'); push(match[1],match[2],i);position=regex.lastIndex; }
        assert(position>0&&!text.slice(position).trim(),'지원하지 않는 ChatML 형식입니다.');
      } else throw new Error('지원하지 않는 블록 유형: '+b.type);
      record.status=messages.length>before?'included':'empty';record.messages=messages.length-before;
    } catch(error) { record.status='error';record.error=error.message;issues.push((i+1)+'. '+record.name+': '+error.message); }
  }
  if(p.promptSettings?.assistantPrefill) {
    try {push('assistant',renderPresetText(p.promptSettings.assistantPrefill,context),-1);}catch(error){issues.push('Assistant prefill: '+error.message);}
  }
  if(userCount!==1)issues.push('이번 공방 요청을 포함하는 채팅 블록이 정확히 1개여야 합니다. 현재 '+userCount+'회 포함됐습니다.');
  return {messages,trace,issues,globals,notes:['로어북 블록은 공방 현재안의 전체 항목을 사용합니다. 본체의 활성화·토큰 예산 계산은 실행하지 않습니다.','페르소나·작가 노트·메모리는 이 프리셋 화면에서 입력한 값을 사용합니다. 본체 상태와 자동 동기화하지 않습니다.']};
}
