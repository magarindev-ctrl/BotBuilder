import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter, sessionFromCharacter, newSession, snapshot, restoreSnapshot, clone, validateRequestImages, withRequestImages, readRequestImage, inputSize, REQUEST_IMAGE_BYTES, saveExisting, conflictFields, jsonSyntaxExamples, parseResponse, applyPacket } from '../src/core.js';
import { exportCharx, importCharx, unpack, characterToCard } from '../src/charx.js';
const image=(size=3)=>({id:'image',name:'capture.png',mime:'image/png',data:'data:image/png;base64,'+Buffer.alloc(size).toString('base64'),width:1,height:1});

test('new-character lore defaults survive export without injecting defaults into existing characters',()=>{
 const fresh=blankCharacter();assert.deepEqual(fresh.loreSettings,{scanDepth:5,tokenBudget:99999,recursiveScanning:false,fullWordMatching:false});
 assert.equal(characterToCard(fresh).data.character_book.token_budget,99999);
 delete fresh.loreSettings;assert.equal(Object.hasOwn(sessionFromCharacter(fresh).draft,'loreSettings'),false);
 fresh.loreSettings={scanDepth:1,tokenBudget:100};assert.deepEqual(sessionFromCharacter(fresh).draft.loreSettings,fresh.loreSettings);
});
test('image validation enforces count, actual encoded bytes, total size, MIME and valid base64',()=>{
 assert.equal(validateRequestImages([image()]).length,1);
 assert.throws(()=>validateRequestImages(Array.from({length:5},()=>image())),/4장/);
 assert.throws(()=>validateRequestImages([image(REQUEST_IMAGE_BYTES+1)]),/5MiB/);
 assert.throws(()=>validateRequestImages([image(5*1024**2),image(5*1024**2),image(3*1024**2)]),/12MiB/);
 for(const invalid of [{...image(),mime:'image/svg+xml'},{...image(),data:'https://example.com/a.png'},{...image(),data:'data:image/png;base64,broken'}]) assert.throws(()=>validateRequestImages([invalid]));
});
test('multimodal messages attach only to the last user message and preserve text and existing attachments',()=>{
 const messages=[{role:'user',content:'previous'},{role:'assistant',content:'reply'},{role:'user',content:'current',multimodals:[{type:'image',base64:'existing'}]},{role:'assistant',content:'prefill'}];
 const original=clone(messages),output=withRequestImages(messages,[image()]);
 assert.deepEqual(messages,original);assert.equal(output[2].multimodals.length,2);assert.equal(output[0].multimodals,undefined);assert.equal(output[3].content,'prefill');
 assert.deepEqual(output[2].multimodals[1],{type:'image',base64:image().data,width:1,height:1});
 assert.throws(()=>withRequestImages([{role:'system',content:'no user'}],[image()]),/사용자 메시지/);
 assert.equal(inputSize(output,100).bytes,inputSize(messages,100).bytes+Buffer.byteLength(image().data));
});
test('request image recovery preserves per-task pending attachments and past messages and rejects corruption',()=>{
 const s=newSession();s.requestImages={workshop:[image()],description:[]};s.thread=[{role:'user',content:'capture',images:[image()]}];
 const restored=restoreSnapshot(snapshot(s));assert.deepEqual(restored.requestImages,s.requestImages);assert.deepEqual(restored.thread,s.thread);
 const broken=clone(s);broken.thread[0].images[0].data='invalid';assert.throws(()=>restoreSnapshot(snapshot(broken)),/이미지/);
});
test('image reader sniffs bytes rather than extension and rejects unknown data and excessive dimensions',async()=>{
 const data=Uint8Array.from([137,80,78,71,13,10,26,10]);
 const file={name:'wrong.txt',size:data.length,arrayBuffer:async()=>data.buffer};
 const doc={createElement:()=>({naturalWidth:2,naturalHeight:3,set src(value){if(value)queueMicrotask(()=>this.onload());}})};
 const result=await readRequestImage(file,doc);assert.equal(result.mime,'image/png');assert.equal(result.width,2);assert.equal(result.height,3);
 await assert.rejects(readRequestImage({...file,arrayBuffer:async()=>Uint8Array.of(1,2,3).buffer},doc),/PNG/);
 await assert.rejects(readRequestImage(file,{createElement:()=>({naturalWidth:10000,naturalHeight:10000,set src(value){if(value)queueMicrotask(()=>this.onload());}})}),/4천만/);
});
function hostFixture(){
 const initial=blankCharacter();initial.desc='base';initial.globalLore=[{id:'entry',comment:'lore',content:'base'}];
 const session=sessionFromCharacter(initial);session.draft.desc='draft';session.draft.globalLore[0].content='draft lore';
 let current=clone(initial);current.desc='host';current.globalLore[0].content='host lore';current.personality='host only';current.chats[0].message.push({data:'latest chat'});let writes=0;
 const api={getDatabase:async()=>({characters:[current]}),getCharacterFromIndex:async()=>clone(current),setCharacterToIndex:async(_,next)=>{writes++;current=clone(next);}};
 return {session,api,get current(){return current;},get writes(){return writes;}};
}
test('host conflict resolution requires every choice and retains host-only fields and latest chats',async()=>{
 const f=hostFixture(),review=await saveExisting(f.api,f.session);assert.equal(f.writes,0);assert.deepEqual(conflictFields(review),['desc','globalLore']);
 await assert.rejects(saveExisting(f.api,f.session,{current:review.current,choices:{desc:'draft'}}),/모든 영역/);assert.equal(f.writes,0);
 const result=await saveExisting(f.api,f.session,{current:review.current,choices:{desc:'draft',globalLore:'current'}});
 assert.deepEqual(result.conflicts,[]);assert.equal(f.current.desc,'draft');assert.equal(f.current.globalLore[0].content,'host lore');assert.equal(f.current.personality,'host only');assert.equal(f.current.chats[0].message[0].data,'latest chat');assert.equal(f.writes,1);
});
test('host changes after conflict review block all writes; chat-only arrivals remain preservable',async()=>{
 const f=hostFixture(),review=await saveExisting(f.api,f.session);f.current.desc='changed again';
 await assert.rejects(saveExisting(f.api,f.session,{current:review.current,choices:{desc:'draft',globalLore:'draft'}}),/비교 이후/);assert.equal(f.writes,0);
 const fresh=await saveExisting(f.api,f.session);f.current.chats[0].message.push({data:'arrived during review'});
 await saveExisting(f.api,f.session,{current:fresh.current,choices:{desc:'current',globalLore:'draft'}});
 assert.equal(f.current.desc,'changed again');assert.equal(f.current.globalLore[0].content,'draft lore');assert.equal(f.current.chats[0].message.length,2);
});
test('JSON syntax examples decode escaped text and produce applicable nested regex edits',()=>{
 for(const task of ['regex','workshop']){
  const parts=jsonSyntaxExamples(task).split(/\n(?=\[정규식)/),scalar=JSON.parse(parts[0].slice(parts[0].indexOf('\n')+1));
  assert.equal(scalar.pattern,String.raw`\d+\s*`);assert.equal(scalar.content,'그는 "출발하자"라고 말했다.\n다음 줄');
  const text=parts[1].slice(parts[1].indexOf('\n')+1),draft=blankCharacter();draft.customscript=[{in:'(기존|항목)',out:'$1',type:'editoutput',flag:'g'}];
  const packet=parseResponse(text,task,draft);assert.equal(applyPacket(draft,packet).customscript[0].in,'(기존|항목|추가)');
 }
});
test('CHARX preserves remote, default and missing embedded metadata with notices and no asset downloads',async()=>{
 const c=blankCharacter();c.ccAssets=[{type:'icon',name:'remote',uri:'https://example.com/icon.png'},{type:'icon',name:'main',uri:'ccdefault:'},{type:'background',name:'missing',uri:'embeded://lost.png'}];
 const notices=[],archive=await exportCharx({readImage:()=>{throw Error('must not fetch');}},c,null,notices),parts=unpack(archive);
 assert.deepEqual(parts.card.data.assets,c.ccAssets);assert.equal(notices.length,3);assert.equal(notices[2].kind,'unresolved-embedded');assert.equal(parts.files['lost.png'],undefined);
 const restored=await importCharx({saveAsset:()=>{throw Error('no embedded bytes');}},archive);assert.deepEqual(restored.character.ccAssets,c.ccAssets);assert.deepEqual(restored.character.additionalAssets,[]);
});
test('CHARX maps local CC asset paths, preserves types and rejects unreadable local or empty paths',async()=>{
 const c=blankCharacter();c.additionalAssets=[['art','local','png']];c.ccAssets=[{type:'background',name:'art',uri:'local',ext:'png'},{type:'icon',name:'other',uri:'local',ext:'png'}];
 const reads=[],archive=await exportCharx({readImage:async path=>{reads.push(path);return Uint8Array.of(1,2,3);}},c);
 assert.deepEqual(reads,['local']);assert.deepEqual(unpack(archive).card.data.assets.map(a=>a.type),['background','icon']);
 c.additionalAssets=[];c.ccAssets=[{type:'icon',name:'bad',uri:'local'}];await assert.rejects(exportCharx({readImage:async()=>null},c),/읽을 수 없습니다/);
 c.ccAssets[0].uri='';await assert.rejects(exportCharx({},c),/URI가 없습니다/);
});
