export const installedModules=()=>[
  {id:'world-id',namespace:'world',name:'세계관 모듈',description:'제작 규칙과 토글 검증',customModuleToggle:'focus=모듈 집중=select=기본,상세',lorebook:[
    {key:'규칙',comment:'제작 규칙',content:'모듈 자료: {{char}} / {{#if_pure {{? {{getglobalvar::toggle_focus}}=1}}}}상세 모드{{/if}}',alwaysActive:true},
    {key:'참조',comment:'상수 자료',content:'모듈 원문 자료',alwaysActive:true}
  ],regex:[],trigger:[],assets:[['지도','assets/map','png']]},
  {id:'script-id',namespace:'script',name:'실행 모듈',description:'실행 항목을 자동 실행하지 않는지 검증',customModuleToggle:'',lorebook:[{key:'정보',content:'실행 제외 후 사용되는 자료'}],regex:[{in:'a',out:'b',type:'editprocess'}],trigger:[{comment:'초기화',type:'start',conditions:[],effect:[{type:'triggerlua',code:'error("should not run")'}]}],cjs:'globalThis.__moduleExecuted=true;',mcp:{url:'https://not-used.invalid'},backgroundEmbedding:'<script>globalThis.__moduleExecuted=true;</script>',assets:[]}
];
export const modulePreset=()=>({name:'모듈 연결 프리셋',moduleIntergration:'world',customPromptTemplateToggle:'',promptTemplate:[{type:'plain',role:'system',text:'모듈 연결={{module_enabled::world}}'}, {type:'lorebook'}, {type:'chat',rangeStart:0,rangeEnd:'end'}]});
