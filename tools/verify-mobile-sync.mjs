// Compare a preserved mobile build with the source rebuild, without running plugin initialization.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const paths=[process.argv[2] ?? 'artifacts/mobile-v0.4.3-original.js','dist/risu_story_workshop.js'];
const sources=await Promise.all(paths.map(p=>readFile(p,'utf8')));
const names=['reviewCandidates','reviewTextValue','reviewPacket','luaFirstTriggers','parseResponse','applyScripts','encodeModule','cardToCharacter','Workshop'];
const contexts=sources.map(source=>{
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,setTimeout,clearTimeout,queueMicrotask,console});
  const boundary=source.indexOf('  // src/main.js');assert.ok(boundary>0);
  vm.runInContext(source.slice(0,boundary)+`globalThis.exposed={${names.join(',')}};})();`,context);
  return context.exposed;
});
const checks=[];
const plain=value=>JSON.parse(JSON.stringify(value));
const compare=async(name,run)=>{
  const results=[];
  for(const context of contexts) {
    try { results.push({value:plain(await run(context))}); }
    catch(error) { if (!/invalid|overlap/.test(name)) throw error; results.push({error:error.message}); }
  }
  assert.deepEqual(results[0],results[1],name);checks.push(name);
};
for(const [source,before] of [['same same','same'],['붉은 달이 떴다.','붉은달이떴다!'],['붉은 달이 하늘에 떴다.','붉은 달이 오늘 떴다.'],['abc','missing']]) {
  await compare('candidate search: '+before,c=>c.reviewCandidates(source,before));
}
for(const mode of ['exact','candidate','manual','skip','overlap','invalid']) {
  await compare('review: '+mode,async c=>{
    const source=mode==='exact'?'same':'same same';
    const value={edits:mode==='overlap'?[{before:'same same',after:'x'},{before:'same',after:'y'}]:[{before:mode==='invalid'?'':mode==='manual'?'missing':'same',after:'new'}]};
    return await c.reviewTextValue(source,value,'text',async({candidates})=>mode==='skip'?null:mode==='manual'?{start:1,end:3,after:'custom'}:{...candidates[0],after:'new'});
  });
}
const triggers=[{effect:[{type:'v2Header'}]},...['first','second'].map(code=>({comment:code,type:'start',conditions:[],effect:[{type:'triggerlua',code}]}))];
await compare('Lua order',c=>c.luaFirstTriggers(triggers));
await compare('serialized module Lua order',c=>{
  const bytes=c.encodeModule({name:'test',triggerscript:triggers},{id:'fixed'});return Array.from(bytes);
});
for(const mode of ['choose','skip','invalid-code']) await compare('packet: '+mode,async c=>{
  const draft={desc:'same same',customscript:[{in:'abc',out:'one'}]};
  const packet=mode==='invalid-code'?{schemaVersion:2,task:'regex',data:{upsert:[{ref:'r0',rule:{out:{edits:[{before:'missing',after:'new'}]}}}],remove:[]}}:{schemaVersion:2,task:'description',data:{text:{edits:[{before:'same',after:'new'}]}}};
  return c.reviewPacket(c.parseResponse(JSON.stringify(packet),packet.task,draft,true),draft,async({candidates})=>mode==='skip'?null:{...candidates[1],after:'new'});
});
await compare('UI locking and cancellation',c=>{
  const dom=new JSDOM('<main><input><button data-action="cancel-request">cancel</button></main>');
  const app=new c.Workshop({},dom.window.document);app.root=dom.window.document.querySelector('main');app.job={};app.lockRequestEditors();
  const locked=[...app.root.querySelectorAll('input,button')].map(el=>el.disabled);app.cancelRequest();
  const result={locked,busy:app.root.getAttribute('aria-busy'),cancelled:app.job.cancelled};dom.window.close();return result;
});
await compare('UI manual range choice',async c=>{
  const dom=new JSDOM('<main></main>'),app=new c.Workshop({},dom.window.document);app.root=dom.window.document.querySelector('main');
  const pending=app.chooseTextRange({source:'abcdef',edit:{before:'missing',after:'new'},label:'text',candidates:[]});
  const original=dom.window.document.querySelector('[readonly]');original.setSelectionRange(1,4);
  const click=label=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent===label).click();
  click('선택한 원문 구간 사용');await new Promise(r=>setTimeout(r,5));click('선택 구간으로 수정안 준비');
  const result=await pending;dom.window.close();return result;
});
await writeFile('verification/mobile-source-sync-results.json',JSON.stringify({scope:'v0.4.3 mobile original vs rebuilt source: candidate search, prose review, validation, Lua ordering, serialization, UI locks and manual selection; not live RisuBard verification',files:paths.map((path,i)=>({path,bytes:Buffer.byteLength(sources[i]),sha256:createHash('sha256').update(sources[i]).digest('hex')})),passed:checks.length,checks},null,2)+'\n');
console.log('Mobile/source implementation comparisons passed:',checks.length);
