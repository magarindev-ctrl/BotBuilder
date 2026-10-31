import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {transformSync} from 'esbuild';
const paths=[process.argv[2]??'artifacts/mobile-v0.4.15-original.js','dist/risu_story_workshop.js'];
const sources=await Promise.all(paths.map(p=>readFile(p,'utf8')));
const names=['VERSION','CSS','REQUEST_IMAGE_TYPES','REQUEST_IMAGE_MAX','REQUEST_IMAGE_BYTES','REQUEST_IMAGE_TOTAL','blankCharacter','sessionFromCharacter','restoreSnapshot','conflictFields','saveExisting','requestImages','validateRequestImages','withRequestImages','readRequestImage','inputSize','jsonSyntaxExamples','jsonContract','importCharx','exportCharx','Workshop'];
const contexts=sources.map(source=>{
 const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,setTimeout,clearTimeout,queueMicrotask,console});
 const boundary=source.indexOf('  // src/main.js');assert.ok(boundary>0);
 vm.runInContext(source.slice(0,boundary)+`globalThis.exposed={${names.join(',')}};})();`,context);
 return context.exposed;
});
const checks=[];
// Parse and normalize JavaScript with the same compiler to ignore whitespace,
// Unicode escaping and compiler-local identifier names, not runtime behavior.
const canonical=code=>transformSync(code.replace(/\bapi2\b/g,"api"),{charset:'utf8',target:'es2022',format:'esm',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,legalComments:'none'}).code;
for(const name of names.filter(n=>n!=='Workshop')) {
 const values=contexts.map(c=>typeof c[name]==='function'?canonical('export default ('+c[name].toString()+');'):JSON.stringify(c[name]));
 assert.equal(values[1],values[0],name);checks.push(name);
}
const methods=['init','destroy','render','renderChat','requestWithScope','previewRequest','sendRequest','saveHost','downloadCharx','fitRequestInput','showMobileMenu','addRequestImages','pasteRequestImages','requestImageComposer','reviewSaveConflicts'];
for(const name of methods) {
 const values=contexts.map(c=>canonical('export default class {'+c.Workshop.prototype[name].toString()+'}'));
 assert.equal(values[1],values[0],'Workshop.'+name);checks.push('Workshop.'+name);
}
await writeFile('verification/mobile-v0.4.15-source-sync-results.json',JSON.stringify({scope:'Compiler-normalized comparison of all changed mobile functions, UI methods, CSS and constants. Regression/browser tests run separately; not live RisuBard validation.',files:paths.map((path,i)=>({path,bytes:Buffer.byteLength(sources[i]),sha256:createHash('sha256').update(sources[i]).digest('hex')})),passed:checks.length,checks},null,2)+'\n');
console.log('Mobile/source normalized comparisons passed:',checks.length);
