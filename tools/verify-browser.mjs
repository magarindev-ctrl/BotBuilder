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
 showContainer:async()=>{},hideContainer:async()=>{},getCharacter:async()=>structuredClone(chars[0]),
 getDatabase:async()=>({characters:structuredClone(chars),characterOrder:chars.map(c=>c.chaId)}),
 getCharacterFromIndex:async i=>structuredClone(chars[i]),setCharacterToIndex:async(i,c)=>{chars[i]=structuredClone(c);},
 setDatabaseLite:async db=>{chars=structuredClone(db.characters);},
 runLLMModel:async o=>{window.__calls.push(o);await new Promise(r=>setTimeout(r,60));
 const task = o.messages[1].content.split('[출력 형식]')[1].includes('"task": "workshop"')?'workshop':'description';
 const data = task==='workshop'?{reply:'기억을 거래하는 항구 도시를 배경으로 시작해볼까요? 사용자의 역할부터 함께 정해보면 좋겠습니다.',changes:[]}:{text:'기억을 거래하는 항구 도시의 기록관. 사람들의 사라진 과거를 찾아주며, 자신의 기억만은 되찾지 못하고 있다.'};
 return {type:'success',result:JSON.stringify({schemaVersion:1,task,data})};},
 saveAsset:async()=> 'assets/mock',readImage:async()=>new Uint8Array([1,2,3])
};`;
const html = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe id="plugin" src="/frame" sandbox="allow-scripts allow-modals allow-downloads"></iframe>';
const frameHtml = '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><script nonce="workshop-test" src="/bundle.js"></script></body></html>';
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(setup + '\n' + bundle); }
  else if (request.url === '/frame') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'nonce-workshop-test'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'" }); response.end(frameHtml); }
  else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.WORKSHOP_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light' });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = await (await page.locator('#plugin').elementHandle()).contentFrame();
  await frame.waitForSelector('#story-workshop');
  await frame.waitForFunction(() => typeof window.__open === 'function');
  await frame.evaluate(() => window.__open());
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#plugin').screenshot({ path: 'artifacts/workshop-desktop.png', animations: 'disabled' });
  const sizes = await frame.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, editor: document.querySelector('.editor').getBoundingClientRect().width, chat: document.querySelector('.conversation').getBoundingClientRect().width }));
  assert.equal(sizes.overflow, false); assert.ok(sizes.editor >= 400 && sizes.chat >= 340); results.push({ name: 'desktop two-pane layout', passed: true, sizes });
  await page.emulateMedia({ colorScheme: 'dark' });
  await frame.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
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
  await writeFile('verification/browser-results.json', JSON.stringify({ scope: 'Actual distributable, Edge headless, sandbox+CSP, mocked API. No live RisuBard/LLM verification.', passed: results.length, results, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.length, errors, screenshots: 6 }, null, 2));
} catch(error) { console.error('Browser errors:', errors); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
