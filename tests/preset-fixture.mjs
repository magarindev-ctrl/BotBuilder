// Independent fixture writer matching upstream downloadPreset, not the plugin decoder.
import { webcrypto } from 'node:crypto';
import { encode } from 'msgpackr/index-no-eval';
import { gzipSync } from 'fflate';
import { rpackMap } from '../src/rpack-map.js';

export const samplePreset = () => ({
  name:'검증용 프리셋',mainPrompt:'기본',
  customPromptTemplateToggle:'=설정=group\nextra=추가 설정\ntone=말투=select=차분함,활기참\nnote=메모=textarea\n=end=groupEnd',
  promptTemplate:[
    {type:'plain',name:'규칙',role:'system',text:'규칙: {{char}} / {{user}}'},
    {type:'plain',name:'조건부',role:'system',text:'{{#when::keep::{{equal::{{getglobalvar::toggle_extra}}::1}}}}\n조건 활성\n{{/when}}'},
    {type:'chat',name:'제작 대화',rangeStart:0,rangeEnd:'end'}
  ],promptSettings:{}
});
export async function encodePreset(preset,{version=2,rpack=true,field='preset'}={}) {
  const key=await webcrypto.subtle.importKey('raw',await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode('risupreset')), {name:'AES-GCM'}, false, ['encrypt']);
  const payload=new Uint8Array(await webcrypto.subtle.encrypt({name:'AES-GCM',iv:new Uint8Array(12)},key,encode(preset)));
  const compressed=gzipSync(encode({presetVersion:version,type:'preset',[field]:payload}));
  return rpack?compressed.map(x=>rpackMap[x]):compressed;
}
