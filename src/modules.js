// SPDX-License-Identifier: GPL-3.0-only
// Installed-module snapshots. Contracts: RisuBard modules.ts / API v3, e5412a4878ae3a0073ffce8e06aed8f288dd9c53.
// Reading/selecting a module never changes host activation or executes its scripts.
import { assert, clone, bytes, equal } from './core.js';

export const MODULE_LIMIT=8*1024*1024;
const badKeys=['__proto__','constructor','prototype'];
function tree(value,depth=0,count={n:0}) {
  assert(depth<70&&++count.n<200000,'모듈 데이터 구조가 너무 큽니다.');
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){assert(!badKeys.includes(key),'허용하지 않는 모듈 키: '+key);tree(item,depth+1,count);}
}
export function normalizeModule(raw) {
  assert(raw&&typeof raw==='object'&&!Array.isArray(raw),'설치 모듈 객체가 필요합니다.');
  assert(typeof raw.id==='string'&&raw.id.trim()&&!badKeys.includes(raw.id),'모듈 ID가 없거나 올바르지 않습니다.');
  const result={};
  for(const key of ['id','name','namespace','description','customModuleToggle','cjs','backgroundEmbedding']) {
    const value=raw[key]??'';assert(typeof value==='string','모듈 문자열 형식 오류: '+key);result[key]=value;
  }
  result.name ||= result.id;
  for(const key of ['lorebook','regex','trigger','assets']) {
    const value=raw[key]??[];assert(Array.isArray(value)&&value.length<=3000,'모듈 배열 형식 또는 개수 오류: '+key);result[key]=value;
  }
  if(raw.mcp!=null)result.mcp=raw.mcp;
  tree(result);assert(bytes(JSON.stringify(result))<=MODULE_LIMIT,'모듈 한 개의 데이터가 8MiB를 초과했습니다.');
  for(const entry of result.lorebook)assert(entry&&typeof entry==='object'&&!Array.isArray(entry)&&typeof entry.content==='string','모듈 로어북 본문이 올바르지 않습니다.');
  for(const asset of result.assets)assert(Array.isArray(asset)&&typeof asset[0]==='string','모듈 에셋 이름 형식이 올바르지 않습니다.');
  return clone(result);
}
export function normalizeModules(raw=[]) {
  assert(Array.isArray(raw)&&raw.length<=100,'선택 모듈은 100개 이하 배열이어야 합니다.');
  const modules=raw.map(normalizeModule),ids=new Set();
  for(const module of modules){assert(!ids.has(module.id),'선택 모듈 ID가 중복됩니다: '+module.id);ids.add(module.id);}
  assert(modules.reduce((n,module)=>n+module.lorebook.length,0)<=3000,'선택 모듈의 로어북 합계는 3,000개 이하만 지원합니다.');
  assert(bytes(JSON.stringify(modules))<=MODULE_LIMIT,'선택 모듈 합계가 8MiB를 초과했습니다.');return modules;
}
export function moduleOptions(state,module) {
  const own=Object.hasOwn(state.moduleOptions??{},module.id)?state.moduleOptions[module.id]:{};
  return {skipRuntime:false,excludedLore:[],...own};
}
export function validateModuleOptions(state) {
  assert(state.moduleOptions&&typeof state.moduleOptions==='object'&&!Array.isArray(state.moduleOptions),'모듈 적용 설정은 객체여야 합니다.');tree(state.moduleOptions);
  const result={};
  for(const module of state.modules) {
    const value=moduleOptions(state,module);
    assert(typeof value.skipRuntime==='boolean'&&Array.isArray(value.excludedLore)&&value.excludedLore.every(i=>Number.isInteger(i)&&i>=0&&i<module.lorebook.length),'모듈 적용 설정이 올바르지 않습니다: '+module.name);
    result[module.id]={skipRuntime:value.skipRuntime,excludedLore:[...new Set(value.excludedLore)]};
  }
  return result;
}
export const activeModules=state=>state.excluded?.modules?[]:state.modules??[];
export const moduleMatches=(module,reference)=>module.id===reference||Boolean(module.namespace&&module.namespace===reference);
export function runtimeFeatures(module) {
  return [module.regex.length?'정규식 '+module.regex.length+'개':'',module.trigger.length?'트리거 '+module.trigger.length+'개':'',module.cjs.trim()?'JS':'',module.mcp?'MCP':'',module.backgroundEmbedding.trim()?'배경 코드':''].filter(Boolean);
}
export async function readInstalledModules(api) {
  assert(typeof api.getDatabase==='function','이 호스트에는 설치 모듈 조회 API가 없습니다.');
  const db=await api.getDatabase(['modules']);
  assert(db&&Array.isArray(db.modules),'설치 모듈 조회 권한이 필요하거나 호스트가 modules 조회를 지원하지 않습니다.');
  const seen=new Set();
  return db.modules.filter(module=>module&&typeof module.id==='string'&&!seen.has(module.id)&&seen.add(module.id));
}
export function selectInstalledModules(state,catalog,ids) {
  const wanted=new Set(ids);
  assert([...wanted].every(id=>catalog.some(m=>m.id===id)),'설치 목록에 없는 모듈을 선택했습니다.');
  // Native getModuleByIds filters the database in its original order and deduplicates by ID.
  const modules=normalizeModules(catalog.filter(module=>wanted.has(module.id))),options={};
  for(const module of modules) {
    const previous=(state.modules??[]).find(old=>old.id===module.id);
    options[module.id]=previous&&equal(previous,module)?moduleOptions(state,module):{skipRuntime:false,excludedLore:[]};
  }
  return {...state,modules,moduleOptions:options,excluded:{...state.excluded,modules:false}};
}
