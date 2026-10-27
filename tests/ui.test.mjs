import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Workshop } from '../src/ui.js';
import { PREFIX, newSession, snapshot } from '../src/core.js';

const wait = () => new Promise(resolve => setTimeout(resolve, 12));
async function make(initial = {}, response = { schemaVersion: 1, task: 'workshop', data: { reply: '세계관부터 함께 정해보죠.', changes: [] } }) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local.test/' });
  const store = new Map(Object.entries(initial)), calls = [], regs = {};
  const api = { pluginStorage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => store.set(k, v), removeItem: async k => store.delete(k) }, registerSetting: async (name, callback) => regs.open = callback, registerButton: async () => ({}), onUnload: async fn => regs.unload = fn, showContainer: async () => {}, hideContainer: async () => {}, runLLMModel: async options => { calls.push(options); return { type: 'success', result: JSON.stringify(response) }; } };
  const app = new Workshop(api, dom.window.document); await app.init(); return { app, dom, store, calls, regs, close: () => { app.destroy(); dom.window.close(); } };
}
const button = (dom, text) => [...dom.window.document.querySelectorAll('button')].find(e => e.textContent === text);
test('workshop renders manuscript + persistent chat, with prompt beside every send action', async () => {
  const x = await make(); try {
    assert.match(x.dom.window.document.body.textContent, /이야기 공방/); assert.equal(x.dom.window.document.querySelectorAll('.editor').length, 1); assert.equal(x.dom.window.document.querySelectorAll('.conversation').length, 1);
    assert.ok(x.dom.window.document.querySelector('[data-action="send-request"]')); assert.ok(x.dom.window.document.querySelector('[data-action="prompt"]'));
    x.app.s.draft.desc = '<img src=x onerror=alert(1)>'; x.app.s.tab = 'description'; x.app.render(); assert.equal(x.dom.window.document.querySelectorAll('img').length, 0);
  } finally { x.close(); }
});
test('autosave does not overwrite initial recovery data and two slots are independent', async () => {
  const previous = newSession(); previous.draft.name = 'recover me';
  const initial = JSON.stringify(snapshot(previous)), x = await make({ [PREFIX + 'autosave']: initial });
  try {
    await x.app.autosave(); assert.equal(x.store.get(PREFIX + 'autosave'), initial);
    x.app.started = true; x.app.s.draft.name = 'manual draft'; x.app.touch(); await x.app.saveSlot('manual');
    assert.equal(x.store.get(PREFIX + 'autosave'), initial);
    x.app.s.draft.name = 'auto draft'; x.app.touch(); await x.app.autosave();
    assert.equal(JSON.parse(x.store.get(PREFIX + 'manual')).name, 'manual draft'); assert.equal(JSON.parse(x.store.get(PREFIX + 'autosave')).name, 'auto draft');
  } finally { x.close(); }
});
test('actual send requires review, records conversation and does not change draft', async () => {
  const x = await make(); try {
    x.app.s.requests.workshop = '판타지 시뮬레이션을 구상해보자'; const before = x.app.s.draft.desc;
    const sending = x.app.sendRequest(); await wait(); assert.equal(x.calls.length, 0);
    button(x.dom, '이 내용으로 요청').click(); await sending;
    assert.equal(x.calls.length, 1); assert.equal(x.calls[0].mode, 'submodel'); assert.equal(x.app.s.thread.length, 2); assert.equal(x.app.s.draft.desc, before); assert.equal(x.app.s.thread[1].content, '세계관부터 함께 정해보죠.');
  } finally { x.close(); }
});
test('generated proposals require explicit apply and stale candidates cannot apply', async () => {
  const x = await make({}, { schemaVersion: 1, task: 'description', data: { text: 'A new character' } });
  try {
    x.app.task = 'description'; x.app.s.requests.description = 'write';
    const sending = x.app.sendRequest(); await wait(); button(x.dom, '이 내용으로 요청').click(); await sending;
    assert.equal(x.app.s.draft.desc, ''); assert.equal(x.app.s.candidates.length, 1);
    await x.app.applyCandidate(x.app.s.candidates[0]); assert.equal(x.app.s.draft.desc, 'A new character');
    x.app.s.candidates[0].status = null; x.app.touch(); await assert.rejects(x.app.applyCandidate(x.app.s.candidates[0]), /다른 시점/);
  } finally { x.close(); }
});
test('prompt save and reset affect only selected task', async () => {
  const x = await make(); try {
    const opening = x.app.showPrompt('description'); await wait();
    const area = x.dom.window.document.querySelector('[aria-label="시스템 프롬프트 전체"]'); area.value += '\ncustom'; area.dispatchEvent(new x.dom.window.Event('input'));
    assert.equal(x.store.has(PREFIX + 'prompt:description'), false);
    button(x.dom, '프롬프트 저장').click(); await wait(); assert.match(JSON.parse(x.store.get(PREFIX + 'prompt:description')).system, /custom/);
    x.store.set(PREFIX + 'manual', 'untouched'); x.store.set(PREFIX + 'prompt:greeting', 'untouched');
    button(x.dom, '기본값으로 초기화').click(); await wait(); assert.equal(x.store.has(PREFIX + 'prompt:description'), false); assert.equal(x.store.get(PREFIX + 'manual'), 'untouched'); assert.equal(x.store.get(PREFIX + 'prompt:greeting'), 'untouched');
    x.app.activeModal.close(null); await opening;
  } finally { x.close(); }
});
test('saved prompt survives reload while unsaved prompt edits remain drafts', async () => {
  const x = await make(); let y;
  try {
    const saved = { system: 'saved system', user: 'saved template' };
    await x.app.store('prompt:description', saved);
    x.app.s.promptDrafts.description = { system: 'unsaved change', user: 'unsaved template' };
    x.app.started = true; await x.app.saveSlot('manual');
    y = await make(Object.fromEntries(x.store));
    assert.deepEqual(y.app.prompts.description, saved);
    assert.equal(y.app.slots.manual.session.promptDrafts.description.system, 'unsaved change');
  } finally { y?.close(); x.close(); }
});
test('late model result is discarded after manuscript changes', async () => {
  const x = await make();
  try {
    let resolve;
    x.app.api.runLLMModel = () => new Promise(done => resolve = done);
    x.app.task = 'description'; x.app.s.requests.description = 'write';
    const pending = x.app.sendRequest(); await wait(); button(x.dom, '이 내용으로 요청').click(); await wait();
    x.app.setField('desc', 'typed while waiting');
    resolve({ type: 'success', result: JSON.stringify({ schemaVersion: 1, task: 'description', data: { text: 'late' } }) });
    await pending;
    assert.equal(x.app.s.draft.desc, 'typed while waiting'); assert.equal(x.app.s.candidates.length, 0); assert.equal(x.app.job, null); assert.equal(x.app.s.thread.at(-1).error, true);
  } finally { x.close(); }
});
