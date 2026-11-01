// Actual bundle in a sandboxed iframe with a mock host. No real model request.
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/core.js';
import { samplePreset, encodePreset } from '../tests/preset-fixture.mjs';
import { installedModules, modulePreset } from '../tests/modules-fixture.mjs';

await mkdir('artifacts', { recursive: true });
const bundle = await readFile('dist/risu_story_workshop.js', 'utf8');
const c = blankCharacter(); c.name = '브라우저 검증용 캐릭터'; c.desc = '원래 설명';
const moduleFixture=JSON.stringify(installedModules()).split('<').join(String.fromCharCode(92)+'u003c');
const setup = `
const store = new Map(); let chars = ${JSON.stringify([c])};
const installedModules=${moduleFixture};window.__moduleSource=JSON.stringify(installedModules);
window.__calls = [];window.__dbReads=[];window.__hostWrites=[];window.__wrapResponse=false;
window.risuai = {
 pluginStorage:{getItem:async k=>store.get(k)??null,setItem:async(k,v)=>store.set(k,v),removeItem:async k=>store.delete(k)},
 registerSetting:async(n,cb)=>{window.__open=cb;},registerButton:async()=>({id:'mock'}),onUnload:async cb=>window.__unload=cb,
 showContainer:async()=>{parent.postMessage({workshopFrame:'show'},'*');},hideContainer:async()=>{parent.postMessage({workshopFrame:'hide'},'*');},getCharacter:async()=>structuredClone(chars[0]),
 getDatabase:async keys=>{window.__dbReads.push(keys);return keys?.includes('modules')?{modules:structuredClone(installedModules)}:{characters:structuredClone(chars),characterOrder:chars.map(c=>c.chaId)};},
 getCharacterFromIndex:async i=>structuredClone(chars[i]),setCharacterToIndex:async(i,c)=>{window.__hostWrites.push('setCharacter');chars[i]=structuredClone(c);},
 setDatabaseLite:async db=>{window.__hostWrites.push('setDatabase');chars=structuredClone(db.characters);},
 runLLMModel:async o=>{window.__calls.push(o);await new Promise(r=>setTimeout(r,60));
 if(window.__responseOverride)return {type:'success',result:window.__responseOverride};
 const task = o.messages.findLast(m=>m.role==='user').content.split('[출력 형식]')[1].includes('"task": "workshop"')?'workshop':'description';
 const data = task==='workshop'?{reply:'기억을 거래하는 항구 도시를 배경으로 시작해볼까요? 사용자의 역할부터 함께 정해보면 좋겠습니다.',changes:[]}:{text:'기억을 거래하는 항구 도시의 기록관. 사람들의 사라진 과거를 찾아주며, 자신의 기억만은 되찾지 못하고 있다.'};
 const result=JSON.stringify({schemaVersion:1,task,data});return {type:'success',result:window.__wrapResponse?'## OOC Response\\n'+result+'\\n응답 뒤의 부가 설명':result};},
 saveAsset:async()=> 'assets/mock',readImage:async()=>new Uint8Array([1,2,3])
};`;
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#765a80}iframe{border:0;width:100%;height:100%}</style><iframe id="plugin" style="display:none!important" sandbox="allow-scripts allow-modals allow-downloads"></iframe><script>addEventListener('message',e=>{const f=document.getElementById('plugin');if(e.source!==f.contentWindow)return;if(e.data?.workshopFrame==='show'){Object.assign(f.style,{position:'fixed',inset:'0',width:'100%',height:'100%',backgroundColor:'transparent'});f.style.setProperty('display','block','important');}else if(e.data?.workshopFrame==='hide')f.style.setProperty('display','none','important');});</script>`;
const frameHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-workshop-test'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'"></head><body><style>body{background-color:transparent}</style><script nonce="workshop-test">${setup}\n${bundle}</script></body></html>`;
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(setup + '\n' + bundle); }
  else if (request.url === '/frame') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'nonce-workshop-test'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'" }); response.end(frameHtml); }
  else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.WORKSHOP_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [], errors = [], layouts = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('Frame console:',m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#plugin').evaluate((iframe, source) => { iframe.srcdoc = source; }, frameHtml);
  const frame = await (await page.locator('#plugin').elementHandle()).contentFrame();
  await frame.waitForSelector('#story-workshop', { state: 'attached' });
  const ensureRequest = async () => {
    const input=frame.getByRole('textbox',{name:'LLM에게 보낼 요청'});
    if (!(await input.inputValue())) await input.fill('다음 검증 요청');
  };
  const toolbarAction = async name => {
    const button=frame.getByRole('button',{name,exact:true});
    if (!(await button.isVisible())) await frame.getByRole('button',{name:'작업 메뉴',exact:true}).click();
    await frame.getByRole('button',{name,exact:true}).click();
  };
  await frame.waitForFunction(() => typeof window.__open === 'function');
  await frame.evaluate(() => window.__open());
  await page.locator('#plugin').waitFor({ state: 'visible' });
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-desktop.png', animations: 'disabled' });
  const sizes = await frame.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, editor: document.querySelector('.editor').getBoundingClientRect().width, chat: document.querySelector('.conversation').getBoundingClientRect().width }));
  assert.equal(sizes.overflow, false); assert.ok(sizes.editor >= 400 && sizes.chat >= 340); results.push({ name: 'desktop two-pane layout', passed: true, sizes });
  const checkLayout = async label => {
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measured = await frame.evaluate(() => {
      const rect = selector => { const element=document.querySelector(selector), r=element.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}; };
      const root=document.querySelector('#story-workshop'), editor=document.querySelector('.editor'), chat=document.querySelector('.conversation');
      const send=document.querySelector('[data-action="send-request"]'), input=document.querySelector('[aria-label="LLM에게 보낼 요청"]');
      const inside = element => { const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1; };
      return { viewport:[innerWidth,innerHeight], pageHeight:document.documentElement.scrollHeight, pageWidth:document.documentElement.scrollWidth, root:rect('#story-workshop'), background:getComputedStyle(root).backgroundColor, workspace:rect('.workspace'), editorVisible:getComputedStyle(editor).display!=='none', editor:rect('.editor'), chatVisible:getComputedStyle(chat).display!=='none', chat:rect('.conversation'), send:rect('[data-action="send-request"]'), sendVisible:inside(send), inputVisible:inside(input) };
    });
    layouts.push({ label, ...measured });
    assert.ok(measured.workspace.height >= 120, label + ': manuscript workspace collapsed');
    assert.ok(measured.workspace.bottom <= measured.viewport[1] + 1, label + ': workspace extends below frame');
    assert.ok(measured.pageHeight <= measured.viewport[1] + 1 && measured.pageWidth <= measured.viewport[0] + 1, label + ': page overflow');
    assert.notEqual(measured.background, 'rgba(0, 0, 0, 0)', label + ': transparent main frame');
    assert.equal(measured.root.height, measured.viewport[1]);
    if (measured.editorVisible) assert.ok(measured.editor.height >= 100 && measured.editor.width >= 200, label + ': missing editor');
    if (measured.chatVisible) assert.ok(measured.sendVisible && measured.inputVisible, label + ': clipped request controls');
  };
  await checkLayout('hidden srcdoc frame opened');
  await frame.getByRole('textbox', { name: '작품·캐릭터 이름' }).fill('긴제목도원고를숨기지않아야합니다'.repeat(20));
  for (const [width,height] of [[1920,1080],[1440,900],[1366,768],[1280,720],[1093,614],[1024,576],[900,600],[841,600],[768,600],[640,480],[390,568],[390,844]]) {
    await page.setViewportSize({width,height});
    await frame.waitForFunction(({width,height}) => innerWidth===width&&innerHeight===height, {width,height});
    await checkLayout(width+'x'+height+' editor');
    if(width<=840) {
      await frame.getByRole('button', {name:'대화',exact:true}).click();
      await checkLayout(width+'x'+height+' chat');
      await frame.getByRole('button', {name:'원고',exact:true}).click();
    }
    if(width===1024) await page.locator('#plugin').screenshot({path:'artifacts/workshop-compact.png',animations:'disabled'});
  }
  await page.setViewportSize({width:1440,height:1000});
  await frame.waitForFunction(() => innerWidth===1440&&innerHeight===1000);
  await frame.getByRole('textbox', { name: '작품·캐릭터 이름' }).fill('이름 없는 이야기');
  await frame.getByRole('textbox', {name:'제작 노트 · LLM과 공유할 방향'}).fill('다시 열어도 원고를 유지합니다.');
  await frame.getByRole('button', {name:'닫기',exact:true}).click(); await page.locator('#plugin').waitFor({state:'hidden'});
  await frame.evaluate(() => window.__open()); await page.locator('#plugin').waitFor({state:'visible'});
  await checkLayout('frame reopened');
  assert.equal(await frame.getByRole('textbox', {name:'제작 노트 · LLM과 공유할 방향'}).inputValue(),'다시 열어도 원고를 유지합니다.');
  results.push({name:'opaque full-frame manuscript after hidden bootstrap, resize and reopen',passed:true,layouts:layouts.length});
  await page.emulateMedia({ colorScheme: 'dark' });
  await frame.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const neutral = await frame.evaluate(() => ['#story-workshop','.editor','.conversation','.composer','.hero','.navitem[aria-current=page]','button.primary'].map(selector=>({selector,background:getComputedStyle(document.querySelector(selector)).backgroundColor,color:getComputedStyle(document.querySelector(selector)).color,gradient:getComputedStyle(document.querySelector(selector)).backgroundImage})));
  for(const surface of neutral) for(const match of (surface.background+' '+surface.color+' '+surface.gradient).matchAll(/rgba?\(([^)]+)\)/g)) {
    const [r,g,b,alpha=1]=match[1].split(',').map(Number); if(alpha===0)continue;
    assert.ok(Math.max(r,g,b)-Math.min(r,g,b)<=1, surface.selector+': unwanted color cast');
  }
  results.push({name:'neutral charcoal dark surfaces and controls',passed:true});
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-dark.png', animations: 'disabled' });
  await frame.getByRole('button', { name: '설정', exact: true }).click();
  await frame.getByRole('combobox', { name: '화면 테마' }).selectOption('light');
  await frame.getByRole('button', { name: '저장', exact: true }).click();
  await frame.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.emulateMedia({ colorScheme: 'light' }); await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), 'light');
  await frame.getByRole('button', { name: '설정', exact: true }).click();
  await frame.getByRole('combobox', { name: '화면 테마' }).selectOption('dark');
  await frame.getByRole('button', { name: '저장', exact: true }).click();
  await frame.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await frame.evaluate(async () => JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:settings')).theme), 'dark');
  results.push({ name: 'system dark mode and persistent explicit theme selection', passed: true });
  await frame.getByRole('textbox', { name: 'LLM에게 보낼 요청' }).fill('기억을 거래하는 도시의 시뮬레이션을 같이 구상하자.');
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.getByText('기억을 거래하는 항구 도시를 배경으로 시작해볼까요?', { exact: false }).waitFor();
  assert.equal(await frame.evaluate(() => window.__calls.length), 1); assert.equal(await frame.locator('.modal-overlay').count(), 0); results.push({ name: 'single-click model request without confirmation dialog', passed: true });
  await frame.locator('[data-action="prompt"]').click();
  await frame.getByRole('dialog').waitFor();
  const modalLayouts = [];
  for (const [width,height] of [[1024,576],[640,480],[390,568]]) {
    await page.setViewportSize({width,height});
    await frame.waitForFunction(({width,height}) => innerWidth===width&&innerHeight===height,{width,height});
    const modal = await frame.evaluate(() => {
      const d=document.querySelector('.modal').getBoundingClientRect(), f=document.querySelector('.modalfoot').getBoundingClientRect(), b=document.querySelector('.modalbody').getBoundingClientRect();
      return {viewport:[innerWidth,innerHeight],left:d.left,right:d.right,top:d.top,bottom:d.bottom,footerBottom:f.bottom,bodyHeight:b.height};
    });
    assert.ok(modal.left>=0&&modal.right<=width+1&&modal.top>=0&&modal.bottom<=height+1&&modal.footerBottom<=height+1&&modal.bodyHeight>0,'clipped prompt dialog '+width+'x'+height);
    modalLayouts.push(modal);
  }
  results.push({name:'prompt dialog body scrolls while footer remains inside the frame',passed:true,layouts:modalLayouts});
  await page.setViewportSize({width:1440,height:1000});
  await frame.waitForFunction(()=>innerWidth===1440&&innerHeight===1000);
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-dark-prompt.png', animations: 'disabled' });
  await frame.getByRole('button', { name: '창 닫기', exact: true }).click();
  await frame.getByRole('combobox', { name: 'LLM 요청 종류' }).selectOption('description');
  await frame.getByRole('textbox', { name: 'LLM에게 보낼 요청' }).fill('도시의 기록관 캐릭터 설명을 써줘.');
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.locator('[data-action="apply-candidate"]').waitFor();
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-proposal.png', animations: 'disabled' });
  await frame.locator('[data-action="apply-candidate"]').click();
  await frame.locator('.navitem').filter({ hasText: '캐릭터 설명' }).click();
  assert.match(await frame.getByRole('textbox', { name: '캐릭터 설명', exact: true }).inputValue(), /항구 도시의 기록관/); results.push({ name: 'explicit proposal apply updates manuscript', passed: true });
  await frame.locator('.navitem').filter({ hasText: '정규식' }).click(); await frame.getByRole('button', { name: '＋ 항목 추가' }).click();
  await frame.getByRole('textbox', { name: 'IN · 찾을 패턴', exact: true }).fill('(cat)');
  await frame.getByRole('textbox', { name: 'OUT · 치환문 / HTML·CSS 원문' }).fill('<b>$1</b>');
  await frame.getByRole('textbox', { name: '테스트 입력', exact: true }).fill('cat cat');
  await frame.getByRole('button', { name: '매칭·치환 테스트', exact: true }).click();
  await frame.getByText('2개 매칭', { exact: false }).waitFor(); assert.equal(await frame.locator('.testresult b').count(), 0);
  results.push({ name: 'RE2JS executes under CSP and displays HTML as text', passed: true });
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-regex.png', animations: 'disabled' });
  await frame.locator('.navitem[data-tab="preset"]').click();
  console.log('Checking binary preset import');
  const chooserPromise=page.waitForEvent('filechooser');
  await frame.locator('[data-action="import-preset"]').click();
  await (await chooserPromise).setFiles({name:'browser-preset.risup',mimeType:'application/octet-stream',buffer:Buffer.from(await encodePreset(samplePreset()))});
  await frame.getByRole('textbox',{name:'프리셋 이름',exact:true}).waitFor();
  assert.equal(await frame.getByRole('textbox',{name:'프리셋 이름',exact:true}).inputValue(),'검증용 프리셋');
  assert.equal(await frame.getByRole('combobox',{name:'요청 구성'}).inputValue(),'preset');
  await frame.getByRole('combobox',{name:'LLM 요청 종류'}).selectOption('description');
  await frame.getByRole('button',{name:'토글 설정',exact:true}).click();
  await frame.getByRole('checkbox',{name:'추가 설정',exact:true}).check();
  await frame.getByRole('combobox',{name:'말투',exact:true}).selectOption('1');
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();
  await frame.getByText('조립 검사 통과',{exact:false}).waitFor();
  assert.match(await frame.locator('.editor').innerText(),/조건 활성/);
  await page.locator('#plugin').screenshot({path:'artifacts/workshop-preset-preview.png',animations:'disabled'});
  await frame.getByRole('button',{name:'토글 설정',exact:true}).click();
  await frame.getByRole('checkbox',{name:'추가 설정',exact:true}).uncheck();
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();
  assert.doesNotMatch(await frame.locator('.editor').innerText(),/조건 활성/);
  results.push({name:'binary risup imported under CSP; v2 toggle condition controls assembled content',passed:true});
  console.log('Checking preset edits and dispatch');
  await frame.getByRole('button',{name:'프롬프트 블록',exact:true}).click();
  await frame.getByRole('textbox',{name:'블록 본문',exact:true}).fill('편집된 규칙 {{char}}');
  await frame.getByRole('combobox',{name:'블록 역할',exact:true}).selectOption('bot');
  await frame.getByRole('button',{name:'아래로',exact:true}).click();
  await page.locator('#plugin').screenshot({path:'artifacts/workshop-preset-blocks.png',animations:'disabled'});
  await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).fill('프리셋을 적용해서 기록관 설명을 다듬어줘.');
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();
  const preview=await frame.locator('.editor section.card').evaluateAll(sections=>sections.map(s=>({role:s.querySelector('h3').textContent.split('. ')[1],content:s.querySelector('pre').textContent})));
  assert.equal(preview[0].role,'assistant');assert.match(preview[0].content,/편집된 규칙/);
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(()=>window.__calls.length===3&&!document.querySelector('[data-action="send-request"]').disabled);
  assert.equal(await frame.locator('[data-action="apply-candidate"]').count(),0);
  assert.match(await frame.locator('.message.assistant .bubble').last().innerText(),/적용할 변경 사항이 없습니다/);
  assert.deepEqual(await frame.evaluate(()=>window.__calls[2].messages),preview);
  await frame.getByRole('button',{name:'프리셋 설정 저장',exact:true}).click();
  await frame.waitForFunction(async()=>Boolean(await risuai.pluginStorage.getItem('risu-character-editor:v1:preset-workspace')));
  const savedPreset=await frame.evaluate(async()=>JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:preset-workspace')));
  assert.equal(savedPreset.values.toggle_tone,'1');assert.equal(savedPreset.preset.promptTemplate[1].role,'bot');
  results.push({name:'block text, role and order edits match transmitted messages; local preset selections save',passed:true});
  await frame.getByRole('button',{name:'프롬프트 블록',exact:true}).click();
  await frame.getByRole('textbox',{name:'블록 본문',exact:true}).fill('{{unsupported_host_macro}}');
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.getByRole('alert').filter({hasText:'지원하지 않는 CBS'}).waitFor();
  assert.equal(await frame.evaluate(()=>window.__calls.length),3);
  results.push({name:'unsupported preset syntax stops before model dispatch',passed:true});
  await frame.getByRole('textbox',{name:'블록 본문',exact:true}).fill("# User's input{{#if_pure {{? {{getglobalvar::toggle_OOC}}=2}}}}(What Cattleya have to respond!){{/if}}");
  await frame.getByRole('button',{name:'토글 설정',exact:true}).click();
  await frame.getByText('토글 정의 원문 편집',{exact:true}).click();
  await frame.getByRole('textbox',{name:'토글 정의',exact:true}).fill(samplePreset().customPromptTemplateToggle+'\nOOC=OOC=select=꺼짐,1,2');
  await frame.getByRole('button',{name:'토글 목록 갱신',exact:true}).click();
  await frame.getByRole('combobox',{name:'OOC',exact:true}).selectOption('2');
  await frame.getByRole('button',{name:'프롬프트 블록',exact:true}).click();
  await frame.getByRole('combobox',{name:'추가할 블록 유형',exact:true}).selectOption('cache');
  await frame.getByRole('button',{name:'블록 추가',exact:true}).click();
  await frame.getByRole('combobox',{name:'캐시 대상 역할',exact:true}).selectOption('user');
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();
  await frame.getByText('조립 검사 통과',{exact:false}).waitFor();
  assert.match(await frame.locator('.editor').innerText(),/What Cattleya have to respond!/);
  await frame.locator('.editor section.card .pill').filter({hasText:'캐시 지점'}).waitFor();
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(()=>window.__calls.length===4&&!document.querySelector('[data-action="send-request"]').disabled);
  assert.ok(await frame.evaluate(()=>window.__calls[3].messages.some(m=>m.role==='user'&&m.cachePoint===true)));
  assert.ok(await frame.evaluate(()=>window.__calls[3].messages.some(m=>m.content.includes('(What Cattleya have to respond!)'))));
  // Error toasts persist until closed; the harness dismisses it like a user would.
  if (await frame.locator('.toast.bad').count()) await frame.locator('.toast.bad .toast-close').click();
  await frame.locator('.toast.bad').waitFor({state:'hidden'});
  await page.locator('#plugin').screenshot({path:'artifacts/workshop-cbs-compat.png',animations:'disabled'});
  await frame.getByRole('button',{name:'토글 설정',exact:true}).click();
  await frame.getByRole('combobox',{name:'OOC',exact:true}).selectOption('1');
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();
  assert.doesNotMatch(await frame.locator('.editor').innerText(),/What Cattleya have to respond!/);
  results.push({name:'reported if_pure/infix syntax responds to OOC toggles under CSP and cachePoint reaches the model API',passed:true});
  const moduleChooser=page.waitForEvent('filechooser');await frame.locator('[data-action="import-preset"]').click();
  await (await moduleChooser).setFiles({name:'module-preset.risup',mimeType:'application/octet-stream',buffer:Buffer.from(await encodePreset(modulePreset()))});
  await frame.waitForFunction(()=>document.querySelector('[aria-label="프리셋 이름"]')?.value==='모듈 연결 프리셋');
  await frame.locator('[data-action="select-modules"]').click();
  await frame.getByRole('dialog',{name:'설치 모듈 선택'}).waitFor();
  const moduleDialogLayouts=[];
  for(const [width,height] of [[1024,576],[640,480],[390,568]]) {
    await page.setViewportSize({width,height});await frame.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
    const layout=await frame.evaluate(()=>{const d=document.querySelector('.modal').getBoundingClientRect(),f=document.querySelector('.modalfoot').getBoundingClientRect(),b=document.querySelector('.modalbody');return {width:innerWidth,height:innerHeight,left:d.left,right:d.right,bottom:d.bottom,footerBottom:f.bottom,bodyHeight:b.clientHeight,overflow:b.scrollWidth>b.clientWidth};});
    assert.ok(layout.left>=0&&layout.right<=width+1&&layout.bottom<=height+1&&layout.footerBottom<=height+1&&layout.bodyHeight>0&&!layout.overflow);moduleDialogLayouts.push(layout);
  }
  await page.setViewportSize({width:1440,height:1000});await frame.waitForFunction(()=>innerWidth===1440&&innerHeight===1000);
  results.push({name:'installed module selection dialog retains its footer and scrollable body at small sizes',passed:true,layouts:moduleDialogLayouts});
  await frame.getByRole('button',{name:'프리셋 참조 모듈 선택',exact:true}).click();
  await frame.getByRole('button',{name:'선택 모듈 적용',exact:true}).click();
  await frame.getByText('모듈 로어북 포함 항목 확인',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'토글 설정',exact:true}).click();
  await frame.getByRole('combobox',{name:'모듈 집중',exact:true}).selectOption('1');
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();
  await frame.getByText('조립 검사 통과',{exact:false}).waitFor();
  assert.match(await frame.locator('.editor').innerText(),/모듈 연결=1/);assert.match(await frame.locator('.editor').innerText(),/상세 모드/);
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(()=>window.__calls.length===5&&!document.querySelector('[data-action="send-request"]').disabled);
  assert.ok(await frame.evaluate(()=>window.__calls[4].messages.some(m=>m.content.includes('모듈 자료:')&&m.content.includes('상세 모드'))));
  assert.deepEqual(await frame.evaluate(()=>window.__hostWrites),[]);assert.deepEqual(await frame.evaluate(()=>window.__dbReads),[['modules']]);
  assert.equal(await frame.evaluate(()=>JSON.stringify(installedModules)===window.__moduleSource),true);
  await page.locator('#plugin').screenshot({path:'artifacts/bb-module-preview.png',animations:'disabled'});
  results.push({name:'installed modules are selected read-only by preset namespace; module toggles and CBS lore reach model messages',passed:true});
  await frame.locator('[data-action="select-modules"]').click();
  await frame.getByRole('checkbox',{name:'실행 모듈 · script-id',exact:true}).check();
  await frame.getByRole('button',{name:'선택 모듈 적용',exact:true}).click();
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();
  await frame.getByText('전송할 수 없는 항목:',{exact:false}).waitFor();
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.getByRole('alert').filter({hasText:'실행은 지원하지 않습니다'}).waitFor();
  assert.equal(await frame.evaluate(()=>window.__calls.length),5);assert.equal(await frame.evaluate(()=>window.__moduleExecuted),undefined);
  await frame.getByRole('button',{name:'모듈',exact:true}).click();
  await frame.getByRole('checkbox',{name:'이 모듈의 요청 관련 미지원 처리를 제외',exact:true}).check();
  await frame.getByRole('button',{name:'프리셋 설정 저장',exact:true}).click();
  await frame.waitForFunction(async()=>JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:preset-workspace')).moduleOptions['script-id'].skipRuntime===true);
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();await frame.getByText('조립 검사 통과',{exact:false}).waitFor();
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(()=>window.__calls.length===6&&!document.querySelector('[data-action="send-request"]').disabled);
  assert.equal(await frame.evaluate(()=>window.__moduleExecuted),undefined);assert.deepEqual(await frame.evaluate(()=>window.__hostWrites),[]);
  results.push({name:'module runtime features block dispatch until explicitly excluded; exclusions persist and no module JS executes',passed:true});
  await frame.locator('[data-action="select-modules"]').click();
  await frame.getByRole('checkbox',{name:'실행 모듈 · script-id',exact:true}).uncheck();
  await frame.getByRole('checkbox',{name:'출력·표시 모듈 · presentation-id',exact:true}).check();
  await frame.getByRole('button',{name:'선택 모듈 적용',exact:true}).click();
  await frame.getByText('BB 요청 단계에 적용하지 않는 항목:',{exact:false}).waitFor();
  assert.equal(await frame.getByRole('checkbox',{name:'이 모듈의 요청 관련 미지원 처리를 제외',exact:true}).count(),0);
  await frame.getByText('정규식·트리거 처리 내역과 원문 확인',{exact:true}).click();
  await frame.getByText('챕터 표기 수정 · editoutput · BB 단계에 미적용',{exact:true}).click();
  assert.match(await frame.locator('.editor').innerText(),/### Chapter \$1/);
  assert.equal(await frame.locator('.editor pre b').count(),0);
  await frame.locator('.toast.bad').waitFor({state:'hidden'});
  await page.locator('#plugin').screenshot({path:'artifacts/bb-runtime-phases.png',animations:'disabled'});
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();await frame.getByText('조립 검사 통과',{exact:false}).waitFor();
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(()=>window.__calls.length===7&&!document.querySelector('[data-action="send-request"]').disabled);
  assert.equal(await frame.evaluate(async()=>JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:preset-workspace')).moduleOptions['presentation-id'].skipRuntime),false);
  assert.equal(await frame.evaluate(()=>window.__moduleExecuted),undefined);
  results.push({name:'output/display rules, ordinary post-chat triggers and background code do not block BB requests; diagnostic source remains text',passed:true});
  const postPreset={...samplePreset(),name:'후처리 호환 프리셋',regex:installedModules()[2].regex,promptTemplate:[{type:'lorebook'},{type:'plain',role:'user',name:'유저 인풋',text:'{{#if {{user_input}}}}\n{{user_input}}\n{{/if}}'},{type:'chat',rangeStart:0,rangeEnd:'end'}]};
  const postChooser=page.waitForEvent('filechooser');await frame.locator('[data-action="import-preset"]').click();
  await (await postChooser).setFiles({name:'post-preset.risup',mimeType:'application/octet-stream',buffer:Buffer.from(await encodePreset(postPreset))});
  await frame.waitForFunction(()=>document.querySelector('[aria-label="프리셋 이름"]')?.value==='후처리 호환 프리셋');
  await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).fill('이전과 다른 이번 요청 USER_INPUT_CURRENT');
  await ensureRequest(); await frame.getByRole('button',{name:'전송 내용',exact:true}).click();await frame.getByText('조립 검사 통과',{exact:false}).waitFor();
  const postTrace=JSON.parse(await frame.locator('.editor details').filter({has:frame.locator('summary').filter({hasText:'블록별 포함·제외 결과'})}).locator('pre').textContent());
  assert.equal(postTrace[1].status,'empty');
  await page.locator('#plugin').screenshot({path:'artifacts/bb-preset-phases.png',animations:'disabled'});
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(()=>window.__calls.length===8&&!document.querySelector('[data-action="send-request"]').disabled);
  assert.equal(await frame.evaluate(()=>window.__calls[7].messages.filter(m=>m.content.includes('USER_INPUT_CURRENT')).length),1);
  assert.equal(await frame.evaluate(()=>window.__calls[7].messages.some(m=>m.content.includes('{{user_input}}'))),false);
  assert.equal(await frame.evaluate(async()=>JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:preset-workspace')).excluded.regex),false);
  results.push({name:'preset postprocessing rules allow dispatch and the reported if user_input block is omitted without duplicating the current request',passed:true});
  await frame.getByRole('combobox',{name:'LLM 요청 종류'}).selectOption('workshop');
  await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).fill('리아의 제작 방향을 함께 정하자.');
  await frame.locator('[data-action="prompt"]').click();
  await frame.getByText('JSON 응답 형식과 예시',{exact:true}).click();
  const outputGuide=frame.getByRole('dialog').locator('details').filter({has:frame.locator('summary').filter({hasText:'JSON 응답 형식과 예시'})});
  assert.match(await outputGuide.innerText(),/올바른 출력 예시/);assert.match(await outputGuide.innerText(),/잘못된 출력 예시/);
  await frame.getByRole('button',{name:'창 닫기',exact:true}).click();
  await frame.evaluate(()=>window.__wrapResponse=true);
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(()=>window.__calls.length===9&&!document.querySelector('[data-action="send-request"]').disabled);
  const cleanedReply=await frame.locator('.message.assistant .bubble').last().innerText();
  assert.match(cleanedReply,/항구 도시/);assert.doesNotMatch(cleanedReply,/OOC Response|schemaVersion|부가 설명/);
  assert.ok(await frame.evaluate(()=>window.__calls[8].messages.some(m=>m.content.includes('올바른 출력 예시')&&m.content.includes('잘못된 출력 예시'))));
  await page.locator('#plugin').screenshot({path:'artifacts/bb-json-output.png',animations:'disabled'});
  results.push({name:'task-specific JSON examples are visible and OOC/trailing response residue is stripped before conversation rendering',passed:true});
  await frame.getByRole('combobox',{name:'요청 구성'}).selectOption('direct');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await frame.getByRole('button', { name: '대화', exact: true }).click();
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-mobile.png', animations: 'disabled' });
  assert.equal(await frame.locator('.editor').isVisible(), false); assert.equal(await frame.locator('.conversation').isVisible(), true); results.push({ name: 'mobile pane switch without horizontal overflow', passed: true });
  await frame.evaluate(() => {
    chars[0].desc = '유지할 첫 줄\n원래 설명\n유지할 마지막 줄';
    chars[0].globalLore = Array.from({length:75}, (_, i) => ({comment:`로어북 ${i+1} · 긴 제목 줄바꿈과 선택 구분 검사`, key:'entry-'+i, content:'BODY_'+i}));
  });
  await toolbarAction('캐릭터 불러오기');
  const characterDialog=frame.getByRole('dialog');
  assert.doesNotMatch(await characterDialog.innerText(),/\[object HTML/);
  const characterSearch=characterDialog.getByRole('textbox',{name:'이름으로 찾기'});
  await characterSearch.fill('없는 캐릭터');
  assert.equal(await characterDialog.getByRole('button',{name:'브라우저 검증용 캐릭터',exact:true}).count(),0);
  await characterSearch.fill('브라우저');
  await page.locator('#plugin').screenshot({path:'artifacts/bb-character-picker-mobile.png',animations:'disabled'});
  await characterDialog.getByRole('button',{name:'브라우저 검증용 캐릭터',exact:true}).click();
  await frame.getByRole('button',{name:'확인',exact:true}).click();
  results.push({name:'character picker renders a real searchable button and loads via the list on mobile',passed:true});
  await frame.locator('.navitem').filter({hasText:'로어북'}).click();
  const loreLayouts=[];
  for(const width of [320,360,390,412,768]) {
    await page.setViewportSize({width,height:850});
    const measured=await frame.evaluate(()=>{
      const list=document.querySelector('.lore-request-list'),rows=[...list.querySelectorAll('.lore-request-item')],rects=rows.map(e=>e.getBoundingClientRect());
      return {width:innerWidth,count:rows.length,overlap:rects.some((r,i)=>i>0&&r.top<rects[i-1].bottom-1),overflow:list.scrollWidth>list.clientWidth+1,scroll:list.scrollHeight>list.clientHeight,minTouch:Math.min(...rows.map(e=>e.querySelector('.lore-request-toggle').getBoundingClientRect().height))};
    });
    assert.equal(measured.count,75);assert.equal(measured.overlap,false);assert.equal(measured.overflow,false);assert.equal(measured.scroll,true);assert.ok(measured.minTouch>=44);loreLayouts.push(measured);
  }
  const scroll=await frame.evaluate(()=>{
    const list=document.querySelector('.lore-request-list');list.scrollTop=800;const before=list.scrollTop;list.querySelectorAll('input')[10].click();
    const next=document.querySelector('.lore-request-list');return {before,after:next.scrollTop,checked:next.querySelectorAll('input')[10].checked};
  });
  assert.equal(scroll.after,scroll.before);assert.equal(scroll.checked,false);
  await toolbarAction('임시 저장');
  await frame.waitForFunction(async()=>JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:manual'))?.session?.loreIncluded?.[10]===false);
  await page.setViewportSize({width:390,height:850});
  await page.locator('#plugin').screenshot({path:'artifacts/bb-lore-mobile.png',animations:'disabled'});
  results.push({name:'75 lorebook rows remain distinct at five widths; checkbox preserves list scroll and persists selection',passed:true,layouts:loreLayouts});
  await page.setViewportSize({width:1440,height:1000});
  await frame.getByRole('combobox',{name:'LLM 요청 종류'}).selectOption('description');
  await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).fill('설명의 한 구간만 수정');
  const beforeCalls=await frame.evaluate(()=>window.__calls.length);
  await frame.evaluate(()=>{window.__responseOverride='## OOC\n'+JSON.stringify({schemaVersion:2,task:'description',data:{text:{edits:[{before:'원래 설명',after:'수정한 설명'}]}}})+'\n완료';});
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(n=>window.__calls.length===n+1&&!document.querySelector('[data-action="send-request"]').disabled,beforeCalls);
  const patchCandidate=frame.locator('.candidate');
  await patchCandidate.locator('summary').click();
  assert.match(await patchCandidate.innerText(),/부분편집 · 기존 2행/);
  assert.match(await patchCandidate.locator('.before').innerText(),/2 \| 원래 설명/);
  assert.doesNotMatch(await patchCandidate.innerText(),/유지할 마지막 줄/);
  await page.locator('#plugin').screenshot({path:'artifacts/bb-text-patch-desktop.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  // Let the breakpoint listener re-render before interacting, so later locators are not detached mid-action.
  await frame.waitForFunction(()=>innerWidth===390&&matchMedia('(max-width: 840px)').matches);
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await frame.getByRole('button',{name:'대화',exact:true}).click();
  // Proposal details open by default on mobile; only click the summary when it is still collapsed.
  assert.equal(await patchCandidate.locator('details').first().evaluate(d=>d.open),true,'mobile proposal details should start expanded');
  await patchCandidate.locator('.before').scrollIntoViewIfNeeded();
  assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#plugin').screenshot({path:'artifacts/bb-text-patch-mobile.png',animations:'disabled'});
  await patchCandidate.locator('[data-action="apply-candidate"]').click();
  await frame.getByRole('button',{name:'원고',exact:true}).click();
  await frame.locator('.navitem').filter({hasText:'캐릭터 설명'}).click();
  assert.equal(await frame.getByRole('textbox',{name:'캐릭터 설명',exact:true}).inputValue(),'유지할 첫 줄\n수정한 설명\n유지할 마지막 줄');
  results.push({name:'v2 compact patch is reviewed with line numbers on desktop/mobile and applies only its exact source span',passed:true});
  await page.setViewportSize({width:1440,height:1000});
  await frame.evaluate(()=>{window.__responseOverride=JSON.stringify({schemaVersion:2,task:'description',data:{text:{edits:[{before:'없는 원문',after:'적용하면 안 됨'}]}}});});
  await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).fill('실패 구간 검증');
  await ensureRequest(); await frame.locator('[data-action="send-request"]').click();
  await frame.getByRole('dialog').waitFor();
  assert.equal(await frame.getByRole('textbox',{name:'캐릭터 설명',exact:true}).isDisabled(),true);
  await frame.getByRole('button',{name:'이 수정 건너뛰기',exact:true}).click();
  await frame.waitForFunction(n=>window.__calls.length===n+2&&!document.querySelector('[data-action="send-request"]').disabled,beforeCalls);
  assert.match(await frame.locator('.message.assistant .bubble').last().innerText(),/변경 사항이 없습니다/);
  assert.equal(await frame.locator('.candidate').count(),0);
  assert.equal(await frame.getByRole('textbox',{name:'캐릭터 설명',exact:true}).inputValue(),'유지할 첫 줄\n수정한 설명\n유지할 마지막 줄');
  results.push({name:'unmatched prose opens explicit review; skipping leaves manuscript intact, unlocks controls and does not retry',passed:true});
  await frame.evaluate(() => {
    chars[0].additionalAssets = Array.from({length:12}, (_, i) => [`에셋 ${i + 1}`, `assets/${i}`, 'png']);
    chars[0].ccAssets = chars[0].additionalAssets.map(a => ({type:'x-risu-asset',name:a[0],uri:a[1]}));
  });
  await toolbarAction('캐릭터 불러오기');
  await frame.getByRole('button',{name:'현재 선택된 캐릭터',exact:true}).click();
  await frame.getByRole('button',{name:'확인',exact:true}).click();
  await frame.locator('.navitem').filter({hasText:'에셋 목록'}).click();
  const assetWrites = await frame.evaluate(() => window.__hostWrites.length);
  const [iconChooser] = await Promise.all([page.waitForEvent('filechooser'),frame.getByRole('button',{name:'봇 아이콘 등록',exact:true}).click()]);
  await iconChooser.setFiles({name:'portrait.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')});
  await frame.getByRole('button',{name:'봇 아이콘 교체',exact:true}).waitFor();
  await frame.getByRole('checkbox',{name:'에셋 1 선택',exact:true}).check();
  await frame.getByRole('checkbox',{name:'에셋 3 선택',exact:true}).check();
  await frame.getByRole('button',{name:'선택 삭제',exact:true}).click();
  await frame.getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await frame.locator('[data-asset-row]').count(),12);
  await frame.getByRole('button',{name:'선택 삭제',exact:true}).click();
  await frame.getByRole('button',{name:'확인',exact:true}).click();
  await frame.waitForFunction(() => document.querySelectorAll('[data-asset-row]').length === 10);
  assert.equal(await frame.locator('[data-asset-row]').count(),10);
  assert.equal(await frame.getByRole('textbox',{name:'에셋 1 이름',exact:true}).inputValue(),'에셋 2');
  await page.locator('#plugin').screenshot({path:'artifacts/bb-assets-desktop.png',animations:'disabled'});
  for (const width of [320,390]) {
    await page.setViewportSize({width,height:850});
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    const rows = await frame.locator('[data-asset-row]').evaluateAll(nodes => nodes.map(n => { const r=n.getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; }));
    assert.ok(rows.every((r,i) => !i || r.top >= rows[i-1].bottom));
  }
  await frame.getByRole('button',{name:'전체 선택',exact:true}).click();
  await frame.waitForFunction(() => document.querySelectorAll('[data-asset-row] input:checked').length === 10);
  assert.equal(await frame.locator('[data-asset-row] input:checked').count(),10);
  await frame.getByRole('button',{name:'선택 해제',exact:true}).click();
  await frame.waitForFunction(() => document.querySelectorAll('[data-asset-row] input:checked').length === 0);
  assert.equal(await frame.locator('[data-asset-row] input:checked').count(),0);
  await page.locator('#plugin').screenshot({path:'artifacts/bb-assets-mobile.png',animations:'disabled'});
  await frame.getByRole('button',{name:'전체 삭제',exact:true}).click();
  await frame.getByRole('button',{name:'확인',exact:true}).click();
  await frame.waitForFunction(() => document.querySelectorAll('[data-asset-row]').length === 0);
  assert.equal(await frame.locator('[data-asset-row]').count(),0);
  assert.equal(await frame.getByRole('button',{name:'전체 삭제',exact:true}).isDisabled(),true);
  await toolbarAction('임시 저장');
  await frame.evaluate(async () => {
    for(let attempt=0;attempt<100;attempt++) {
      const draft=JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:manual')).session.draft;
      if(draft.image==='assets/mock'&&draft.additionalAssets.length===0&&Array.isArray(draft.ccAssets)&&draft.ccAssets.length===0)return;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw new Error('Latest asset snapshot was not persisted');
  });
  const storedAssets = await frame.evaluate(async () => ({draft:JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:manual')).session.draft,writes:window.__hostWrites.length}));
  assert.deepEqual(storedAssets.draft.ccAssets,[]); assert.equal(storedAssets.writes,assetWrites);
  assert.equal(storedAssets.draft.image,'assets/mock');
  await frame.getByRole('button',{name:'봇 아이콘 해제',exact:true}).click();
  await frame.getByRole('button',{name:'확인',exact:true}).click();
  await frame.getByRole('button',{name:'봇 아이콘 등록',exact:true}).waitFor();
  assert.equal(await frame.getByRole('button',{name:'봇 아이콘 해제',exact:true}).isDisabled(),true);
  results.push({name:'bot icon file selection, draft registration, persistence across bulk asset deletion and explicit removal',passed:true});
  results.push({name:'asset selection, cancelled/multiple/all deletion, metadata persistence and mobile layout at 320/390px; no implicit host writes',passed:true});
  assert.deepEqual(errors, []);
  // Decode real PNG bytes in the browser, including the clipboard path.
  await page.setViewportSize({width:1440,height:1000});
  await frame.getByRole('combobox',{name:'LLM 요청 종류'}).selectOption('description');
  await page.setViewportSize({width:390,height:568});
  await frame.getByRole('button',{name:'대화',exact:true}).click();
  const png=await frame.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;canvas.getContext('2d').fillRect(0,0,4,3);return canvas.toDataURL('image/png').split(',')[1];});
  await frame.locator('input[aria-label="요청에 이미지 첨부"]').setInputFiles({name:'capture.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await frame.waitForFunction(()=>document.querySelectorAll('.request-previews img').length===1);
  await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).fill('');
  await frame.evaluate(png=>{
    const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0)),transfer=new DataTransfer();
    transfer.items.add(new File([bytes],'clipboard.png',{type:'image/png'}));transfer.setData('text/plain','이 화면을 설명해줘');
    document.querySelector('[aria-label="LLM에게 보낼 요청"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
  },png);
  await frame.waitForFunction(()=>document.querySelectorAll('.request-previews img').length===2);
  assert.equal(await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).inputValue(),'이 화면을 설명해줘');
  await checkLayout('390x568 chat with two image previews');
  await page.locator('#plugin').screenshot({path:'artifacts/bb-request-images-mobile.png',animations:'disabled'});
  await frame.getByRole('button',{name:'캐릭터 설명 ▾',exact:true}).click();
  await frame.getByRole('combobox',{name:'LLM 요청 종류'}).selectOption('workshop');
  // Attachments are scoped to the request task; switch back to description.
  await frame.getByRole('button',{name:'설계 대화 ▾',exact:true}).click();
  await frame.getByRole('combobox',{name:'LLM 요청 종류'}).selectOption('description');
  assert.equal(await frame.locator('.request-previews img').count(),2);
  await frame.evaluate(()=>{window.__responseOverride=JSON.stringify({schemaVersion:1,task:'description',data:{text:'이미지를 참고한 제안'}});});
  const imageCall=await frame.evaluate(()=>window.__calls.length);
  await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(n=>window.__calls.length===n+1&&!document.querySelector('[data-action="send-request"]').disabled,imageCall);
  const attached=await frame.evaluate(n=>window.__calls[n].messages.flatMap(m=>m.multimodals??[]),imageCall);
  assert.equal(attached.length,2);assert.ok(attached.every(i=>i.type==='image'&&i.width===4&&i.height===3&&i.base64.startsWith('data:image/png;base64,')));
  assert.equal(await frame.locator('.request-previews img').count(),0);assert.equal(await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).inputValue(),'');
  await frame.getByRole('textbox',{name:'LLM에게 보낼 요청'}).fill('이어서 설명해줘');await frame.locator('[data-action="send-request"]').click();
  await frame.waitForFunction(n=>window.__calls.length===n+2&&!document.querySelector('[data-action="send-request"]').disabled,imageCall);
  assert.equal(await frame.evaluate(n=>window.__calls[n+1].messages.flatMap(m=>m.multimodals??[]).length,imageCall),0);
  await frame.getByRole('button',{name:'이미지 다시 첨부',exact:true}).click();
  assert.equal(await frame.locator('.request-previews img').count(),2);
  await toolbarAction('임시 저장');
  await frame.waitForFunction(async()=>JSON.parse(await risuai.pluginStorage.getItem('risu-character-editor:v1:manual')).session.requestImages?.description?.length===2);
  results.push({name:'mobile file and clipboard image decoding, task isolation, multimodal dispatch, composer reset, explicit reattachment and storage persistence',passed:true});
  assert.deepEqual(errors, []);
  await writeFile('verification/browser-results.json', JSON.stringify({ scope: 'Actual distributable, Edge headless, initially hidden srcdoc iframe, transparent host body, sandbox+CSP and mocked API. No live RisuBard/LLM verification.', passed: results.length, results, layouts, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.length, errors, screenshots: 21, layouts:layouts.length }, null, 2));
} catch(error) { console.error('Browser errors:', errors); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
