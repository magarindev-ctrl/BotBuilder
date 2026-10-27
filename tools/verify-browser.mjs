// Actual bundle in a sandboxed iframe with a mock host. No real model request.
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/core.js';

await mkdir('artifacts', { recursive: true });
const bundle = await readFile('dist/risu_story_workshop.js', 'utf8');
const c = blankCharacter(); c.name = '브라우저 검증용 캐릭터'; c.desc = '원래 설명';
const setup = `
const store = new Map(); let chars = ${JSON.stringify([c])};
window.__calls = [];
window.risuai = {
 pluginStorage:{getItem:async k=>store.get(k)??null,setItem:async(k,v)=>store.set(k,v),removeItem:async k=>store.delete(k)},
 registerSetting:async(n,cb)=>{window.__open=cb;},registerButton:async()=>({id:'mock'}),onUnload:async cb=>window.__unload=cb,
 showContainer:async()=>{parent.postMessage({workshopFrame:'show'},'*');},hideContainer:async()=>{parent.postMessage({workshopFrame:'hide'},'*');},getCharacter:async()=>structuredClone(chars[0]),
 getDatabase:async()=>({characters:structuredClone(chars),characterOrder:chars.map(c=>c.chaId)}),
 getCharacterFromIndex:async i=>structuredClone(chars[i]),setCharacterToIndex:async(i,c)=>{chars[i]=structuredClone(c);},
 setDatabaseLite:async db=>{chars=structuredClone(db.characters);},
 runLLMModel:async o=>{window.__calls.push(o);await new Promise(r=>setTimeout(r,60));
 const task = o.messages[1].content.split('[출력 형식]')[1].includes('"task": "workshop"')?'workshop':'description';
 const data = task==='workshop'?{reply:'기억을 거래하는 항구 도시를 배경으로 시작해볼까요? 사용자의 역할부터 함께 정해보면 좋겠습니다.',changes:[]}:{text:'기억을 거래하는 항구 도시의 기록관. 사람들의 사라진 과거를 찾아주며, 자신의 기억만은 되찾지 못하고 있다.'};
 return {type:'success',result:JSON.stringify({schemaVersion:1,task,data})};},
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
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#plugin').evaluate((iframe, source) => { iframe.srcdoc = source; }, frameHtml);
  const frame = await (await page.locator('#plugin').elementHandle()).contentFrame();
  await frame.waitForSelector('#story-workshop', { state: 'attached' });
  await frame.waitForFunction(() => typeof window.__open === 'function');
  await frame.evaluate(() => window.__open());
  await page.locator('#plugin').waitFor({ state: 'visible' });
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-desktop.png', animations: 'disabled' });
  const sizes = await frame.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, editor: document.querySelector('.editor').getBoundingClientRect().width, chat: document.querySelector('.conversation').getBoundingClientRect().width }));
  assert.equal(sizes.overflow, false); assert.ok(sizes.editor >= 400 && sizes.chat >= 340); results.push({ name: 'desktop two-pane layout', passed: true, sizes });
  const checkLayout = async label => {
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
  await frame.locator('[data-action="send-request"]').click();
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
  await frame.locator('[data-action="send-request"]').click();
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
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await frame.getByRole('button', { name: '대화', exact: true }).click();
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-mobile.png', animations: 'disabled' });
  assert.equal(await frame.locator('.editor').isVisible(), false); assert.equal(await frame.locator('.conversation').isVisible(), true); results.push({ name: 'mobile pane switch without horizontal overflow', passed: true });
  assert.deepEqual(errors, []);
  await writeFile('verification/browser-results.json', JSON.stringify({ scope: 'Actual distributable, Edge headless, initially hidden srcdoc iframe, transparent host body, sandbox+CSP and mocked API. No live RisuBard/LLM verification.', passed: results.length, results, layouts, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.length, errors, screenshots: 7, layouts:layouts.length }, null, 2));
} catch(error) { console.error('Browser errors:', errors); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
