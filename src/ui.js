import { CSS } from './style.js';
import { VERSION, PREFIX, FIELDS, TASKS, clone, equal, uid, tick, assert, editable, blankCharacter, newSession, sessionFromCharacter, snapshot, restoreSnapshot, luaEntries, defaultPrompt, composeMessages, parseResponse, applyPacket, mergeCharacter, listCharacters, saveExisting, saveNew, callModel, regexTest } from './core.js';
import { importCharx, exportCharx } from './charx.js';
import { newPresetState, validatePresetState, assemblePreset } from './preset-engine.js';
import { renderPresetEditor } from './preset-ui.js';

const TABS = [['overview', '제작 노트'], ['description', '캐릭터 설명'], ['lorebook', '로어북'], ['regex', '정규식'], ['lua', 'Lua · 변수'], ['greeting', '첫 메시지'], ['assets', '에셋 목록'], ['preset', '프롬프트 프리셋']];
const fieldNames = { name: '이름', desc: '캐릭터 설명', globalLore: '로어북', customscript: '정규식', triggerscript: 'Lua·트리거', defaultVariables: '초기 변수', firstMessage: '첫 메시지', additionalAssets: '에셋 목록' };
const SETTINGS = { model: 'submodel', timeout: 300, maxInputChars: 100000, theme: 'system' };

export class Workshop {
  constructor(api, doc) {
    this.api = api; this.doc = doc; this.s = newSession(); this.prompts = {}; this.settings = { ...SETTINGS };
    this.s.preset = newPresetState(); this.savedPreset = null;
    this.started = false; this.serial = 0; this.autoSerial = 0; this.slots = {}; this.ioBusy = false; this.job = null;
    this.view = 'editor'; this.task = 'workshop'; this.scopeOnly = false; this.storageQueue = Promise.resolve();
  }
  h(tag, props = {}, ...children) {
    const e = this.doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') e.className = value;
      else if (key.startsWith('on')) e.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'text') e.textContent = value;
      else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') e[key] = value;
      else if (value !== null && value !== undefined) e.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) e.append(child?.nodeType ? child : this.doc.createTextNode(String(child)));
    return e;
  }
  b(label, action, kind = '', props = {}) {
    const e = this.h('button', { type: 'button', class: kind, ...props }, label);
    e.addEventListener('click', () => this.runButton(e, action)); return e;
  }
  async runButton(button, action) {
    if (button.disabled) return;
    const previous = [...button.childNodes]; button.disabled = true;
    button.replaceChildren(this.h('span', { class: 'spinner', 'aria-hidden': 'true' }), this.doc.createTextNode('작업 중'));
    try { await tick(); await action(); } catch (error) { this.toast(error.message, true); }
    finally { button.replaceChildren(...previous); button.disabled = false; }
  }
  field(label, value, onInput, options = {}) {
    const tag = options.tag ?? 'textarea', { tag: _, ...extra } = options;
    const input = this.h(tag, { value: value ?? '', 'aria-label': label, ...extra });
    input.addEventListener('input', () => onInput(input.value));
    return this.h('label', { class: 'field' }, this.h('span', {}, label), input);
  }
  select(value, options, change, label) {
    const e = this.h('select', { 'aria-label': label }, options.map(([v, text]) => this.h('option', { value: v, selected: value === v }, text)));
    e.addEventListener('change', () => change(e.value)); return e;
  }
  check(label, checked, change) {
    const e = this.h('input', { type: 'checkbox', checked }); e.addEventListener('change', () => change(e.checked));
    return this.h('label', { class: 'row muted' }, e, label);
  }
  touch(draft = true) {
    this.started = true; this.serial++;
    if (draft) this.s.revision++;
    this.status();
  }
  setField(key, value) { this.s.draft[key] = value; this.touch(); }
  presetChanged() { this.s.promptRevision++; this.touch(false); }
  dirty() { return this.s.targetId ? !equal(this.s.base, editable(this.s.draft)) : this.started; }
  toast(message, bad = false) {
    this.toastEl?.remove(); clearTimeout(this.toastTimer);
    this.toastEl = this.h('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status' }, message);
    this.doc.body.append(this.toastEl); this.toastTimer = setTimeout(() => this.toastEl?.remove(), 7000);
  }
  async init() {
    const style = this.h('style', {}, CSS); this.doc.head.append(style);
    this.doc.documentElement.lang = 'ko';
    this.root = this.h('main', { id: 'story-workshop' }); this.doc.body.append(this.root);
    const setting = await this.api.pluginStorage.getItem(PREFIX + 'settings');
    try { if (setting) this.settings = { ...SETTINGS, ...JSON.parse(setting) }; } catch { /* Keep corrupt data for user recovery. */ }
    if (!['model', 'submodel'].includes(this.settings.model)) this.settings.model = 'submodel';
    if (!Number.isFinite(this.settings.timeout) || this.settings.timeout < 10 || this.settings.timeout > 3600) this.settings.timeout = 300;
    if (!Number.isFinite(this.settings.maxInputChars) || this.settings.maxInputChars < 1000 || this.settings.maxInputChars > 1000000) this.settings.maxInputChars = 100000;
    if (!['system', 'light', 'dark'].includes(this.settings.theme)) this.settings.theme = 'system';
    this.themeMedia = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    this.themeListener = () => this.applyTheme();
    this.themeMedia?.addEventListener('change', this.themeListener);
    this.applyTheme();
    await Promise.all(Object.keys(TASKS).map(async task => {
      const raw = await this.api.pluginStorage.getItem(PREFIX + 'prompt:' + task);
      try { if (raw) { const p = JSON.parse(raw); if (typeof p.system === 'string' && typeof p.user === 'string') this.prompts[task] = p; } } catch { /* Do not overwrite unreadable overrides. */ }
    }));
    const savedPreset = await this.api.pluginStorage.getItem(PREFIX + 'preset-workspace');
    if (savedPreset) {
      try { this.savedPreset = validatePresetState(typeof savedPreset === 'string' ? JSON.parse(savedPreset) : savedPreset); this.s.preset = clone(this.savedPreset); }
      catch (error) { this.toast('프리셋 설정을 불러오지 못했습니다. 저장된 원본은 유지했습니다: ' + error.message, true); }
    }
    await this.readSlots();
    this.render();
    const open = async () => { await this.api.showContainer('fullscreen'); this.render(); if (!this.opened) { this.opened = true; if (this.slots.autosave || this.slots.manual) await this.showRecovery(true); } };
    await this.api.registerSetting('봇빌더', open, 'BB', 'html');
    await this.api.registerButton({ name: '봇빌더', icon: 'BB', iconType: 'html', location: 'hamburger' }, open);
    this.autoTimer = setInterval(() => this.autosave().catch(error => this.toast('자동 저장 실패: ' + error.message, true)), 180000);
    this.elapsedTimer = setInterval(() => this.jobStatus(), 1000);
    await this.api.onUnload(() => this.destroy());
  }
  destroy() { clearInterval(this.autoTimer); clearInterval(this.elapsedTimer); clearTimeout(this.toastTimer); this.themeMedia?.removeEventListener('change', this.themeListener); this.job?.stop?.(); this.activeModal?.close(null); }
  applyTheme() { this.doc.documentElement.dataset.theme = this.settings.theme === 'system' ? this.themeMedia?.matches ? 'dark' : 'light' : this.settings.theme; }
  async readSlots() {
    for (const name of ['autosave', 'manual']) {
      const raw = await this.api.pluginStorage.getItem(PREFIX + name);
      if (!raw) { this.slots[name] = null; continue; }
      try { const s = restoreSnapshot(raw); if(s.preset)s.preset=validatePresetState(s.preset); const v = typeof raw === 'string' ? JSON.parse(raw) : raw; this.slots[name] = { ...v, session: s }; }
      catch (error) { this.slots[name] = { error: error.message, name: '읽을 수 없는 저장본' }; }
    }
  }
  async store(key, data) {
    const text = JSON.stringify(data);
    const work = this.storageQueue.catch(() => {}).then(() => this.api.pluginStorage.setItem(PREFIX + key, text));
    this.storageQueue = work; await work;
  }
  async saveSlot(name) {
    assert(this.started, '새 작업을 시작하거나 원고를 불러온 뒤 저장해 주세요.');
    this.s.requestSettings = { ...this.settings, task: this.task, scopeOnly: this.scopeOnly };
    const serial = this.serial, value = snapshot(this.s);
    await this.store(name, value); this.slots[name] = value;
    if (name === 'autosave') this.autoSerial = serial;
    this.status();
  }
  async autosave() { if (this.started && this.serial !== this.autoSerial) await this.saveSlot('autosave'); }
  status() {
    if (!this.statusEl) return;
    const date = key => this.slots[key]?.savedAt ? new Date(this.slots[key].savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '없음';
    this.statusEl.textContent = `${this.dirty() ? '원고 편집 중' : '변경 없음'} · 자동 ${date('autosave')} · 임시 ${date('manual')}`;
    if (this.titleEl) this.titleEl.textContent = this.s.draft.name || '이름 없는 이야기';
    const counts = this.root?.querySelectorAll('.navcount');
    if (counts?.length) { counts[2].textContent = this.s.draft.globalLore?.length ?? 0; counts[3].textContent = this.s.draft.customscript?.length ?? 0; }
  }
  jobStatus() {
    if (this.regexStatusEl?.isConnected) this.regexStatusEl.textContent = this.regexJob ? `텍스트 검사 중 · ${Math.floor((Date.now() - this.regexJob.start) / 1000)}초` : '';
    if (!this.jobEl) return;
    this.jobEl.replaceChildren();
    if (this.job) this.jobEl.append(this.h('span', { class: 'spinner', 'aria-hidden': 'true' }), this.doc.createTextNode(`${this.job.label} · ${Math.floor((Date.now() - this.job.start) / 1000)}초`));
    else this.jobEl.textContent = '메인·보조 모델은 리스바드 설정을 사용합니다.';
  }
  render() {
    const h = this.h.bind(this), s = this.s;
    this.statusEl = h('span', { class: 'status-text', 'aria-live': 'polite' }); this.titleEl = h('strong', { class: 'document-name', title: s.draft.name }, s.draft.name);
    const header = h('header', { class: 'topbar' }, h('div', { class: 'brand' }, h('div', { class: 'brandmark', 'aria-hidden': 'true' }, 'BB'), h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 'eyebrow' }, 'BOT BUILDER'), h('h1', {}, '봇빌더'))),
      h('div', { class: 'row document-title' }, this.titleEl, h('span', { class: 'pill' }, s.targetId ? '기존 캐릭터' : '새 제작 원고')),
      h('div', { class: 'row header-actions' }, this.statusEl, this.b('설정', () => this.showSettings(), 'ghost small'), this.b('닫기', () => this.api.hideContainer(), 'ghost small')));
    const tools = h('div', { class: 'toolbar' }, h('div', { class: 'toolbar-files' }, this.b('＋ 새 작업', () => this.newWork()), this.b('캐릭터 불러오기', () => this.loadCharacters()), this.b('charx 열기', () => this.chooseCharx())), h('div', { class: 'toolbar-saves' }, this.b('임시 저장', async () => { await this.saveSlot('manual'); this.toast('수동 임시 저장본을 갱신했습니다.'); }), this.b('저장본 불러오기', () => this.showRecovery()), this.b('charx 내보내기', () => this.downloadCharx()), this.b(s.targetId ? '캐릭터에 저장' : '새 캐릭터로 저장', () => this.saveHost(), 'primary')), h('div', { class: 'mobile-switch' }, this.b('원고', () => { this.view = 'editor'; this.render(); }, 'small', { 'aria-pressed': this.view === 'editor' }), this.b('대화', () => { this.view = 'chat'; this.render(); }, 'small', { 'aria-pressed': this.view === 'chat' })));
    this.editor = h('section', { class: 'editor', 'aria-label': '제작 원고' });
    const sidebar = h('nav', { class: 'sidebar', 'aria-label': '원고 구성' }, h('span', { class: 'eyebrow' }, 'MANUSCRIPT'), TABS.map(([id, name], i) => this.b([h('span', { class: 'navnum' }, String(i + 1).padStart(2, '0')), name, h('span', { class: 'navcount' }, id === 'lorebook' ? s.draft.globalLore?.length ?? 0 : id === 'regex' ? s.draft.customscript?.length ?? 0 : '')], () => { s.tab = id; if (Object.hasOwn(TASKS,id)) this.task = id; this.view = 'editor'; this.touch(false); this.render(); }, 'navitem', { 'aria-current': s.tab === id ? 'page' : null })), h('div', { class: 'sidefoot muted' }, '대화로 구상하고,\n원고로 구체화하세요.', h('p', { style: 'margin-top:12px' }, `v${VERSION} · 3분 자동 저장`)));
    const chat = this.renderChat();
    this.workspace = h('div', { class: 'workspace', 'data-view': this.view }, sidebar, this.editor, chat);
    this.root.replaceChildren(header, tools, this.workspace);
    this.renderEditor(); this.status(); this.jobStatus();
  }
  renderEditor() {
    const h = this.h.bind(this), s = this.s;
    const title = TABS.find(([id]) => id === s.tab)?.[1] ?? '제작 노트';
    const hint = { overview: '만들고 싶은 이야기와 작업 방향을 기록합니다.', description: '설정과 행동의 기준이 되는 본문입니다.', lorebook: '세계관과 인물을 항목별로 나눠 관리합니다.', regex: '치환 규칙과 HTML/CSS를 원문으로 편집하고 텍스트로 테스트합니다.', lua: '기존 이벤트와 효과를 유지하며 Lua 코드와 초기 변수를 편집합니다.', greeting: '사용자가 이야기 안으로 들어오는 첫 장면입니다.', assets: '이미지를 렌더링하지 않고 이름과 에셋 참조를 관리합니다.', preset: '가져온 프리셋의 블록·토글을 편집하고 공방 요청을 조립합니다. 본체 프리셋은 변경하지 않습니다.' };
    this.editor.replaceChildren(h('div', { class: 'sectionhead' }, h('span', { class: 'eyebrow' }, 'WORKING DRAFT'), h('h2', { style: 'margin-top:7px' }, title), h('p', { class: 'muted' }, hint[s.tab])));
    const body = h('div', { class: 'stack' }); this.editor.append(body);
    if (s.tab === 'overview') {
      body.append(h('div', { class: 'hero' }, h('span', { class: 'eyebrow' }, 'A STORY BEGINS WITH A QUESTION'), h('h2', { style: 'margin-top:10px' }, '어떤 이야기를 만들까요?'), h('p', {}, '오른쪽에서 LLM과 방향을 의논하고, 설명·로어북·시작 장면을 함께 다듬어 보세요. 제안은 검토한 뒤 원고에 적용됩니다.'), h('div', { class: 'steps' }, ['01 구상과 대화', '02 원고와 수정안', '03 검토하고 저장'].map(t => h('span', { class: 'step' }, t)))),
        h('div', { class: 'grid2' }, this.field('작품·캐릭터 이름', s.draft.name, v => this.setField('name', v), { tag: 'input' }), h('label', { class: 'field' }, h('span', {}, '만들고 있는 것'), this.select(s.kind, [['character', '캐릭터'], ['simulation', '시뮬레이션']], v => { s.kind = v; this.touch(); }, '제작 종류'))),
        this.field('제작 노트 · LLM과 공유할 방향', s.brief, v => { s.brief = v; this.touch(); }, { placeholder: '장르, 사용자 역할, 원하는 분위기, 지켜야 할 규칙, 아직 정하지 못한 부분…', style: 'min-height:220px' }),
        h('p', { class: 'muted' }, '제작 노트와 대화 기록은 작업 저장본에 보관됩니다. 캐릭터 본문에는 승인한 원고만 저장됩니다.'));
    } else if (s.tab === 'description') {
      body.append(this.field('캐릭터 설명', s.draft.desc, v => this.setField('desc', v), { class: 'textarea-large', placeholder: '성격, 배경, 말투, 관계, 행동 원칙…' }),
        h('div', { class: 'grid2' }, this.field('성격 요약', s.draft.personality, v => this.setField('personality', v)), this.field('시나리오', s.draft.scenario, v => this.setField('scenario', v))),
        h('details', {}, h('summary', {}, '추가 프롬프트 · 예시 대화'), h('div', { class: 'stack' }, this.field('시스템 프롬프트', s.draft.systemPrompt, v => this.setField('systemPrompt', v)), this.field('예시 대화', s.draft.exampleMessage, v => this.setField('exampleMessage', v)), this.field('제작자 노트', s.draft.creatorNotes, v => this.setField('creatorNotes', v)))));
      this.editorAction(body, 'description');
    } else if (s.tab === 'lorebook' || s.tab === 'regex') this.renderList(body, s.tab);
    else if (s.tab === 'lua') this.renderLua(body);
    else if (s.tab === 'greeting') {
      body.append(this.field('퍼스트 메시지', s.draft.firstMessage, v => this.setField('firstMessage', v), { class: 'textarea-large', placeholder: '첫 장면 또는 상황 선택 단추와 연결된 본문…' }));
      const alts = s.draft.alternateGreetings ?? [];
      const list = h('div', { class: 'stack' });
      const draw = () => list.replaceChildren(alts.map((a, i) => h('div', { class: 'card stack' }, this.field(`대체 인사말 ${i + 1}`, a, v => { alts[i] = v; s.draft.alternateGreetings = alts; this.touch(); }), this.b('삭제', () => { alts.splice(i, 1); s.draft.alternateGreetings = alts; this.touch(); draw(); }, 'small danger')))); draw();
      body.append(h('details', {}, h('summary', {}, `대체 인사말 ${alts.length}개`), list, this.b('대체 인사말 추가', () => { alts.push(''); s.draft.alternateGreetings = alts; this.touch(); draw(); }, 'small')),
        h('p', { class: 'muted' }, '시작 상황 선택 요청은 첫 메시지·Lua·변수·필요 정규식을 묶어서 제안합니다.'));
      this.editorAction(body, 'greeting'); this.editorAction(body, 'choiceGreeting');
    } else if (s.tab === 'assets') this.renderAssets(body);
    else if (s.tab === 'preset') renderPresetEditor(this,body);
  }
  editorAction(host, task) {
    host.append(this.h('div', { class: 'row' }, this.b('LLM과 ' + TASKS[task].label + ' 다듬기', () => { this.task = task; this.view = 'chat'; this.render(); this.requestInput?.focus(); }), this.b('프롬프트', () => this.showPrompt(task), 'small')));
  }
  renderList(host, task) {
    const h = this.h.bind(this), s = this.s, lore = task === 'lorebook', field = lore ? 'globalLore' : 'customscript';
    s.draft[field] ??= []; const list = s.draft[field];
    const selected = Math.min(Math.max(s.selected[task] ?? 0, 0), Math.max(list.length - 1, 0)); s.selected[task] = selected;
    const nav = h('div', { class: 'itemlist' }, list.map((x, i) => this.b(x.comment || `항목 ${i + 1}`, () => { s.selected[task] = i; this.touch(false); this.renderEditor(); }, 'listitem' + (i === selected ? ' active' : ''))));
    const edit = h('div', { class: 'stack' }), item = list[selected];
    host.append(h('div', { class: 'row' }, this.b('＋ 항목 추가', () => { list.push(lore ? { key: '', secondkey: '', content: '', comment: '새 로어', insertorder: 100, mode: 'normal', alwaysActive: false, selective: false } : { comment: '새 규칙', in: '', out: '', type: 'editdisplay', flag: 'g', ableFlag: true }); s.selected[task] = list.length - 1; this.touch(); this.renderEditor(); }, 'small'), h('span', { class: 'muted' }, `${list.length}개 항목`)), h('div', { class: 'list-editor' }, nav, edit));
    if (!item) edit.append(h('div', { class: 'empty' }, '항목을 추가하거나 LLM에게 작성을 요청하세요.'));
    else {
      const change = (key, value) => { item[key] = value; this.touch(); };
      edit.append(this.field('항목 이름', item.comment, v => change('comment', v), { tag: 'input' }));
      if (lore) edit.append(this.field('키워드 · 쉼표 구분', item.key, v => change('key', v), { tag: 'input' }), this.field('본문', item.content, v => change('content', v), { style: 'min-height:260px' }), h('div', { class: 'grid2' }, this.field('보조 키워드', item.secondkey, v => change('secondkey', v), { tag: 'input' }), this.field('삽입 순서', item.insertorder, v => change('insertorder', Number(v)), { tag: 'input', type: 'number' })), h('div', { class: 'row' }, this.check('항상 활성화', item.alwaysActive, v => change('alwaysActive', v)), this.check('보조 키워드 사용', item.selective, v => change('selective', v)), this.check('키워드를 정규식으로', item.useRegex, v => change('useRegex', v))), h('label', { class: 'field' }, h('span', {}, '모드'), this.select(item.mode, ['normal', 'multiple', 'constant', 'child', 'folder'].map(v => [v, v]), v => change('mode', v), '로어북 모드')));
      else {
        edit.append(this.field('IN · 찾을 패턴', item.in, v => change('in', v), { class: 'code', style: 'min-height:90px' }), this.field('OUT · 치환문 / HTML·CSS 원문', item.out, v => change('out', v), { class: 'code', style: 'min-height:230px' }), h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', {}, '적용 유형'), this.select(item.type, [['editinput', '입력'], ['editoutput', '출력'], ['editprocess', '처리'], ['editdisplay', '표시']], v => change('type', v), '정규식 적용 유형')), this.field('플래그', item.flag, v => change('flag', v), { tag: 'input' })), this.check('지정한 플래그 사용 · 끄면 기본 g', item.ableFlag, v => change('ableFlag', v)));
        const result = h('div', { class: 'stack testresult', 'aria-live': 'polite' });
        this.regexStatusEl = h('p', { class: 'muted', role: 'status' });
        edit.append(h('hr', { class: 'ruled' }), h('h3', {}, '정규식 텍스트 테스트'), this.field('테스트 입력', s.regexInput, v => { s.regexInput = v; this.touch(false); }, { class: 'code' }),
          h('div', { class: 'row' }, this.b('매칭·치환 테스트', async () => {
            assert(!this.regexJob, '정규식 테스트가 진행 중입니다.'); const job = { cancelled: false, start: Date.now() }; this.regexJob = job; this.jobStatus();
            try { const r = await regexTest(clone(item), s.regexInput, job); result.replaceChildren(h('p', { class: r.limited ? 'warn' : 'muted' }, `${r.matches.length}개 매칭 · ${r.note}`), h('h3', {}, '치환 결과'), h('pre', { class: 'diff' }, r.output), h('details', {}, h('summary', {}, '매칭 위치 · 캡처 그룹'), h('pre', { class: 'diff' }, JSON.stringify(r.matches, null, 2)))); }
            finally { this.regexJob = null; this.jobStatus(); }
          }, 'small'), this.b('테스트 중단', () => { if (this.regexJob) this.regexJob.cancelled = true; }, 'small')), this.regexStatusEl, result);
      }
      edit.append(h('div', { class: 'row' }, this.b('위로', () => { if (selected > 0) { [list[selected - 1], list[selected]] = [list[selected], list[selected - 1]]; s.selected[task]--; this.touch(); this.renderEditor(); } }, 'small'), this.b('아래로', () => { if (selected + 1 < list.length) { [list[selected + 1], list[selected]] = [list[selected], list[selected + 1]]; s.selected[task]++; this.touch(); this.renderEditor(); } }, 'small'), this.b('항목 삭제', async () => { if (await this.confirm('항목을 삭제할까요?', item.comment || '선택 항목')) { list.splice(selected, 1); this.touch(); this.renderEditor(); } }, 'small danger')));
    }
    this.editorAction(host, task);
  }
  renderLua(host) {
    const h = this.h.bind(this), s = this.s;
    host.append(this.field('초기 변수 · 한 줄에 key=value', s.draft.defaultVariables, v => this.setField('defaultVariables', v), { class: 'code', placeholder: 'scene=none\ntrust=0' }));
    const entries = luaEntries(s.draft);
    host.append(h('div', { class: 'row' }, this.b('＋ Lua 추가', () => { s.draft.triggerscript.push({ comment: '새 Lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: '-- RisuAI Lua\n' }] }); this.touch(); this.renderEditor(); }, 'small'), h('span', { class: 'muted' }, `${entries.length}개 Lua · 전체 트리거 ${(s.draft.triggerscript ?? []).length}개`)));
    for (const e of entries) {
      const t = s.draft.triggerscript[e.ti];
      host.append(h('div', { class: 'card stack' }, this.field('Lua 이름', t.comment, v => { t.comment = v; this.touch(); }, { tag: 'input' }), h('label', { class: 'field' }, h('span', {}, '트리거 유형'), this.select(t.type, ['start', 'manual', 'input', 'output', 'display', 'request'].map(v => [v, v]), v => { t.type = v; this.touch(); }, '트리거 유형')), this.field('Lua 코드', e.code, v => { t.effect[e.ei].code = v; this.touch(); }, { class: 'code', style: 'min-height:280px' }), h('details', {}, h('summary', {}, '보존 중인 조건·효과 구조'), h('pre', { class: 'diff' }, JSON.stringify({ conditions: t.conditions, effectTypes: t.effect.map(x => x.type) }, null, 2))), this.b('이 Lua 효과 삭제', async () => { if (await this.confirm('Lua 효과를 삭제할까요?', '다른 효과와 트리거 조건은 유지됩니다.')) { t.effect.splice(e.ei, 1); if (!t.effect.length) s.draft.triggerscript.splice(e.ti, 1); this.touch(); this.renderEditor(); } }, 'small danger')));
    }
    if (!entries.length) host.append(h('div', { class: 'empty' }, 'Lua 코드를 추가하거나 LLM에게 변수·이벤트 작성을 요청하세요.'));
    this.editorAction(host, 'lua');
  }
  renderAssets(host) {
    const h = this.h.bind(this), s = this.s, list = s.draft.additionalAssets ??= [];
    host.append(h('p', { class: 'muted' }, '등록 해제는 이 원고의 참조만 제거합니다. 공유될 수 있는 실제 파일은 삭제하지 않습니다.'));
    const names = new Set();
    for (const [i, tuple] of list.entries()) {
      const duplicate = names.has(tuple[0]); names.add(tuple[0]);
      host.append(h('div', { class: 'card stack' }, h('div', { class: 'assetrow' }, this.h('input', { value: tuple[0], 'aria-label': `에셋 ${i + 1} 이름`, onInput: e => { tuple[0] = e.target.value; this.touch(); } }), this.h('input', { value: tuple[1], 'aria-label': `에셋 ${i + 1} 참조`, onInput: e => { tuple[1] = e.target.value; this.touch(); } }), this.h('input', { value: tuple[2], 'aria-label': `에셋 ${i + 1} 확장자`, onInput: e => { tuple[2] = e.target.value; this.touch(); } }), this.b('해제', async () => { if (await this.confirm('에셋 등록을 해제할까요?', tuple[0])) { list.splice(i, 1); this.touch(); this.renderEditor(); } }, 'small danger')), duplicate || !tuple[1] ? h('p', { class: 'error muted' }, duplicate ? '중복된 에셋 이름입니다.' : '에셋 참조가 없습니다.') : null));
    }
    if (!list.length) host.append(h('div', { class: 'empty' }, '아직 등록한 이미지 에셋이 없습니다.'));
    host.append(this.b('이미지 파일 등록', async () => {
      const file = await this.file('image/*'); if (!file) return;
      assert(file.size <= 20 * 1024 * 1024, '이미지는 20MiB 이하만 등록할 수 있습니다.');
      const target = this.s.sessionId, data = new Uint8Array(await file.arrayBuffer());
      const path = await this.api.saveAsset(data); assert(this.s.sessionId === target, '작업 대상이 바뀌어 참조를 추가하지 않았습니다.');
      const ext = file.name.split('.').pop().toLowerCase(); this.s.draft.additionalAssets.push([file.name.replace(/\.[^.]+$/, ''), path, ext]); this.touch(); this.renderEditor();
    }));
  }
  renderChat() {
    const h = this.h.bind(this), s = this.s;
    const panel = h('aside', { class: 'conversation', 'aria-label': 'LLM 제작 대화' });
    panel.append(h('div', { class: 'chathead row between' }, h('div', {}, h('span', { class: 'eyebrow' }, 'CO-WRITING'), h('h3', { style: 'margin-top:6px' }, '함께 만드는 대화')), this.b('대화 비우기', async () => { if (await this.confirm('제작 대화를 비울까요?', '원고와 수정안은 유지됩니다. 대화 기록만 삭제됩니다.')) { this.s.thread = []; this.touch(false); this.render(); } }, 'ghost small')));
    const messages = h('div', { class: 'messages', role: 'log', 'aria-label': '제작 대화 기록' }); this.messagesEl = messages;
    if (!s.thread.length) messages.append(h('div', { class: 'chatempty' }, h('span', { class: 'eyebrow' }, 'LET’S MAKE SOMETHING'), h('h3', { style: 'margin-top:10px' }, '한 가지 아이디어부터 시작하세요.'), h('p', {}, '“이 세계관에 어울리는 인물부터 같이 정해보자.”\n“이 설정의 모순을 찾아줘.”\n“지금 정한 내용을 설명과 로어북으로 제안해줘.”'), h('p', { style: 'margin-top:14px' }, '대화와 수정안은 원고와 구분해 보관합니다.')));
    for (const message of s.thread) {
      const row = h('article', { class: 'message ' + message.role }, h('span', { class: 'msglabel' }, message.role === 'user' ? 'YOU' : 'WRITING PARTNER'), h('div', { class: 'bubble' + (message.error ? ' error' : '') }, message.content));
      if (message.raw) row.append(h('details', {}, h('summary', {}, '응답 원문'), h('pre', { class: 'diff' }, message.raw)));
      messages.append(row);
    }
    for (const candidate of s.candidates.filter(c => !c.status)) {
      const stale = !this.candidateValid(candidate);
      const card = h('article', { class: 'candidate' }, h('div', { class: 'row between' }, h('strong', {}, '원고 수정안'), h('span', { class: 'pill' }, stale ? '원고가 변경됨' : '검토 대기')),
        h('p', { class: 'muted' }, candidate.label), this.diffView(candidate),
        h('div', { class: 'row' }, this.b('원고에 적용', () => this.applyCandidate(candidate), 'primary small', { disabled: stale, 'data-action': 'apply-candidate' }), this.b('폐기', () => { candidate.status = 'discarded'; this.touch(false); this.render(); }, 'small')),
        stale ? h('p', { class: 'warn' }, '요청 이후 원고·프롬프트가 바뀌었습니다. 이 제안은 적용할 수 없습니다. 현재 원고로 다시 요청하세요.') : null);
      messages.append(card);
    }
    this.jobEl = h('div', { class: 'jobbar', role: 'status', 'aria-live': 'polite' });
    this.requestInput = h('textarea', { 'aria-label': 'LLM에게 보낼 요청', placeholder: this.task === 'workshop' ? '아이디어를 이야기하거나, 현재 원고에서 다듬을 부분을 물어보세요.' : TASKS[this.task].label + ' 작성·수정 요청을 적으세요.', value: s.requests[this.task] ?? '' });
    this.requestInput.addEventListener('input', () => { s.requests[this.task] = this.requestInput.value; this.touch(false); });
    this.requestInput.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); if (!this.job) this.sendButton.click(); } });
    const taskSelect = this.select(this.task, Object.entries(TASKS).map(([k, v]) => [k, v.label]), v => { this.task = v; this.render(); }, 'LLM 요청 종류');
    const model = this.select(this.settings.model, [['submodel', '보조 모델'], ['model', '메인 모델']], async v => { this.settings.model = v; this.touch(false); await this.store('settings', this.settings).catch(error => this.toast(error.message, true)); }, 'LLM 모델');
    const sendLabel = this.job ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), '작업 중'] : this.task === 'workshop' ? '함께 구상하기 ↗' : '수정안 요청 ↗';
    const send = this.b(sendLabel, () => this.sendRequest(), 'primary fill', { disabled: !!this.job, 'data-action': 'send-request' }); this.sendButton = send;
    const scope = ['lorebook', 'regex'].includes(this.task) && (s.draft[this.task === 'lorebook' ? 'globalLore' : 'customscript'] ?? []).length ? this.check('현재 선택한 항목만 수정', this.scopeOnly, v => { this.scopeOnly = v; }) : null;
    const composition = this.select(s.preset.mode,[['direct','직접 요청'],['preset','프리셋 요청']],v=>{s.preset.mode=v;this.presetChanged();if(v==='preset'&&!s.preset.preset){s.tab='preset';this.view='editor';}this.render();},'요청 구성');
    panel.append(messages, h('div', { class: 'composer' }, h('div', { class: 'request-options' }, taskSelect, model, composition), scope, this.requestInput,
      h('div', { class: 'row' }, send, this.b('프롬프트', () => this.showPrompt(this.task), '', { 'data-action': 'prompt' }), this.job ? this.b('대기 중단', () => this.job?.stop?.(), 'danger small') : null), this.jobEl, h('p', { class: 'muted' }, 'Ctrl + Enter 전송 · 생성 결과는 검토 후 원고에 적용됩니다.')));
    queueMicrotask(() => { messages.scrollTop = messages.scrollHeight; });
    return panel;
  }
  candidateValid(c) { return c.sessionId === this.s.sessionId && c.targetId === this.s.targetId && c.revision === this.s.revision && c.promptRevision === this.s.promptRevision; }
  diffView(candidate) {
    const h = this.h.bind(this);
    let after;
    try { after = applyPacket(candidate.before, candidate.packet); }
    catch (error) { return h('p', { class: 'warn' }, '수정안을 해석할 수 없습니다: ' + error.message); }
    const changed = FIELDS.filter(f => !equal(candidate.before[f], after[f]));
    return h('details', {}, h('summary', {}, `변경 내용 ${changed.length}개 영역 확인`), changed.map(field => h('section', { class: 'stack', style: 'gap:7px;margin:12px 0' }, h('h3', {}, fieldNames[field] ?? field), h('div', { class: 'diff' }, h('pre', { class: 'before' }, typeof candidate.before[field] === 'string' ? candidate.before[field] : JSON.stringify(candidate.before[field], null, 2)), h('pre', { class: 'after' }, typeof after[field] === 'string' ? after[field] : JSON.stringify(after[field], null, 2))))));
  }
  async applyCandidate(candidate) {
    assert(this.candidateValid(candidate), '현재 원고와 다른 시점의 수정안입니다. 다시 요청하세요.');
    const next = applyPacket(this.s.draft, candidate.packet);
    assert(this.candidateValid(candidate), '원고가 바뀌었습니다.');
    this.s.draft = next; candidate.status = 'applied'; this.touch(); this.render(); this.toast('수정안을 원고에 적용했습니다. 실제 캐릭터 저장은 별도입니다.');
  }
  requestWithScope(task) {
    const s = this.s, request = (s.requests[task] ?? '').trim();
    const scope = this.scopeOnly && ['lorebook', 'regex'].includes(task) && (s.draft[task === 'lorebook' ? 'globalLore' : 'customscript'] ?? []).length ? (task === 'lorebook' ? 'l' : 'r') + (s.selected[task] ?? 0) : null;
    return { request, scope, text: request + (scope ? '\n[허용 편집 범위] 기존 항목 ' + scope + '만 수정·삭제할 수 있다. 새 항목 추가와 다른 항목 변경은 금지한다.' : '') };
  }
  previewRequest(task=this.task,forcePreset=false) {
    const usePreset=forcePreset||this.s.preset.mode==='preset';
    const direct=composeMessages(usePreset?{...this.s,thread:[]}:this.s,task,this.requestWithScope(task).text,this.prompts[task]??defaultPrompt(task));
    if(usePreset)return assemblePreset(this.s.preset,this.s,task,direct);
    return {messages:direct,trace:[],issues:[],notes:[],globals:{}};
  }
  async sendRequest() {
    assert(!this.job, '다른 LLM 요청이 진행 중입니다.');
    const task = this.task, s = this.s, { request, scope } = this.requestWithScope(task);
    assert(request, 'LLM에게 전달할 요청을 적어 주세요.');
    const report = this.previewRequest(task);
    assert(!report.issues.length,'프리셋 조립 오류:\n'+report.issues.join('\n'));
    const messages = report.messages;
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    assert(chars <= this.settings.maxInputChars, `전송 내용이 설정한 ${this.settings.maxInputChars.toLocaleString()}자 한도를 초과했습니다. 대화·참고자료·작업 범위를 직접 조정해 주세요. 자동으로 잘라 보내지 않습니다.`);
    const meta = { sessionId: s.sessionId, targetId: s.targetId, revision: s.revision, promptRevision: s.promptRevision };
    const before = clone(s.draft), job = { ...meta, id: uid(), start: Date.now(), label: TASKS[task].label + ' · 응답 대기', cancelled: false };
    this.job = job;
    s.thread.push({ id: uid(), role: 'user', content: request, task }); this.touch(false); this.render();
    let raw;
    try {
      raw = await callModel(this.api, messages, this.settings.model, this.settings.timeout, job);
      assert(!job.cancelled && this.job?.id === job.id && this.candidateValid(meta), '요청 이후 작업 대상·원고·프롬프트가 바뀌어 응답을 폐기했습니다.');
      const packet = parseResponse(raw, task, before);
      if (scope) {
        assert(packet.data.upsert.every(x => x.ref === scope) && packet.data.remove.every(x => x === scope), '선택한 항목 밖의 변경이 포함되어 제안을 거부했습니다.');
      }
      const changes = task === 'workshop' ? packet.data.changes.length : 1;
      s.thread.push({ id: uid(), role: 'assistant', content: task === 'workshop' ? packet.data.reply : TASKS[task].label + ' 수정안을 작성했습니다. 아래에서 변경 내용을 검토하세요.' });
      if (changes) s.candidates.push({ ...meta, id: uid(), label: TASKS[task].label + ' · ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), before, packet });
      this.touch(false);
    } catch (error) {
      if (this.s.sessionId === s.sessionId) { s.thread.push({ id: uid(), role: 'assistant', content: error.message, error: true, ...(raw ? { raw } : {}) }); this.touch(false); }
    } finally { if (this.job?.id === job.id) this.job = null; this.render(); }
  }
  async showPrompt(task) {
    const h = this.h.bind(this), draft = this.s.promptDrafts[task] ??= clone(this.prompts[task] ?? defaultPrompt(task));
    await this.dialog(TASKS[task].label + ' · 프롬프트', body => {
      const saved = h('p', { class: 'muted' }, '저장한 템플릿이 다음 요청에 사용됩니다. 아래 편집 중인 내용은 저장 전까지 전송되지 않습니다.');
      const actual = h('pre', { class: 'diff' });
      const preview = () => { try { const report=this.previewRequest(task); actual.textContent=(report.issues.length?'전송할 수 없는 항목:\n'+report.issues.join('\n')+'\n\n':'')+JSON.stringify(report.messages, null, 2); } catch (e) { actual.textContent = e.message; } };
      const system = this.field('시스템 프롬프트 전체', draft.system, v => { draft.system = v; this.touch(false); }, { class: 'code', style: 'min-height:220px' });
      const user = this.field('사용자 프롬프트 템플릿', draft.user, v => { draft.user = v; this.touch(false); }, { class: 'code', style: 'min-height:230px' });
      body.append(saved, system, user, h('div', { class: 'row' }, this.b('프롬프트 저장', async () => {
        composeMessages(this.s, task, this.s.requests[task] ?? '', draft);
        await this.store('prompt:' + task, draft); this.prompts[task] = clone(draft); this.s.promptRevision++; this.touch(false); preview(); saved.textContent = '저장했습니다. 다음 요청부터 이 프롬프트를 사용합니다.';
      }, 'primary'), this.b('기본값으로 초기화', async () => {
        await this.api.pluginStorage.removeItem(PREFIX + 'prompt:' + task); delete this.prompts[task];
        const defaults = defaultPrompt(task); Object.assign(draft, defaults);
        system.querySelector('textarea').value = draft.system; user.querySelector('textarea').value = draft.user;
        this.s.promptRevision++; this.touch(false); preview(); saved.textContent = '내장 기본 프롬프트로 초기화했습니다.';
      })), h('details', {}, h('summary', {}, '저장된 템플릿으로 구성한 실제 전송 메시지'), actual)); preview();
    });
    this.render();
  }
  async showSettings() {
    const next = clone(this.settings);
    const result = await this.dialog('작업 설정', body => {
      body.append(this.h('label', { class: 'field' }, this.h('span', {}, '화면 테마'), this.select(next.theme, [['system', '시스템 설정 따르기'], ['light', '라이트 모드'], ['dark', '다크 모드']], v => next.theme = v, '화면 테마')), this.field('LLM 대기 제한 · 초 (10~3,600)', next.timeout, v => next.timeout = Number(v), { tag: 'input', type: 'number', min: 10, max: 3600 }), this.field('전체 전송 문자 한도 (1,000~1,000,000)', next.maxInputChars, v => next.maxInputChars = Number(v), { tag: 'input', type: 'number', min: 1000, max: 1000000 }), this.h('p', { class: 'muted' }, '자동 저장 간격은 3분입니다. 자동 저장과 수동 임시 저장은 각각 최근 1개를 보관합니다. 대기 중단은 실제 네트워크 취소를 보장하지 않습니다. 플러그인은 자동 재시도하지 않으며, 호스트 자체의 재시도 정책은 호스트 설정을 따릅니다.'));
    }, [{ label: '취소', value: false }, { label: '저장', value: true, kind: 'primary' }]);
    if (result) {
      assert(Number.isInteger(next.timeout) && next.timeout >= 10 && next.timeout <= 3600 && Number.isInteger(next.maxInputChars) && next.maxInputChars >= 1000 && next.maxInputChars <= 1000000, '설정 범위를 확인하세요.');
      await this.store('settings', next); this.settings = next; this.applyTheme(); this.render(); this.toast('설정을 저장했습니다.');
    }
  }
  async guardReplace() {
    assert(!this.ioBusy, '파일·캐릭터 작업이 진행 중입니다.');
    if (this.dirty() || this.s.thread.length || this.s.candidates.some(c => !c.status)) return this.confirm('지금 작업을 바꿀까요?', '원고·제작 대화·수정안을 바꿉니다. 남길 내용이 있으면 먼저 임시 저장하세요.');
    return true;
  }
  async replaceSession(session) {
    const preset=session.preset?validatePresetState(session.preset):clone(this.savedPreset??newPresetState());
    this.job?.stop?.('작업이 바뀌어 이전 요청의 대기를 중단했습니다.');
    this.s = session; this.s.preset=preset;
    if (session.requestSettings) {
      const p = session.requestSettings;
      if (['model', 'submodel'].includes(p.model)) this.settings.model = p.model;
      if (Number.isInteger(p.timeout) && p.timeout >= 10 && p.timeout <= 3600) this.settings.timeout = p.timeout;
      if (Number.isInteger(p.maxInputChars) && p.maxInputChars >= 1000 && p.maxInputChars <= 1000000) this.settings.maxInputChars = p.maxInputChars;
      if (TASKS[p.task]) this.task = p.task;
      this.scopeOnly = !!p.scopeOnly;
    } else { this.task = 'workshop'; this.scopeOnly = false; }
    this.started = true; this.serial++; this.view = 'editor'; this.render();
  }
  async newWork() { if (await this.guardReplace()) await this.replaceSession(newSession()); }
  async loadCharacters() {
    const db = await this.api.getDatabase(['characters']); assert(db?.characters, '캐릭터 접근 권한이 필요합니다.');
    const chars = listCharacters(db).filter(c => c && (!c.type || c.type === 'character'));
    let selected = null;
    await this.dialog('캐릭터 불러오기', body => {
      const results = this.h('div', { class: 'stack' });
      const draw = query => results.replaceChildren(chars.filter(c => c.name?.toLowerCase().includes(query.toLowerCase())).map(c => this.b(c.name || '(이름 없음)', async () => { selected = c.chaId; this.activeModal.close(true); })));
      body.append(this.field('이름으로 찾기', '', draw, { tag: 'input', placeholder: '캐릭터 검색' }), this.b('현재 선택된 캐릭터', async () => { const c = await this.api.getCharacter(); assert(c?.chaId && (!c.type || c.type === 'character'), '현재 선택된 일반 캐릭터가 없습니다.'); selected = c.chaId; this.activeModal.close(true); }), results); draw('');
    });
    if (!selected || !await this.guardReplace()) return;
    const latest = await this.api.getDatabase(['characters']), c = listCharacters(latest).find(c => c.chaId === selected);
    assert(c, '대상 캐릭터를 찾지 못했습니다.');
    await this.replaceSession(sessionFromCharacter(c));
  }
  async showRecovery(initial = false) {
    await this.readSlots();
    let choice = null;
    await this.dialog(initial ? '이어서 작업할 저장본이 있습니다' : '작업 저장본 불러오기', body => {
      for (const key of ['autosave', 'manual']) {
        const v = this.slots[key];
        body.append(this.h('div', { class: 'card stack' }, this.h('h3', {}, key === 'autosave' ? '자동 저장 · 최근 1개' : '수동 임시 저장 · 최근 1개'), this.h('p', { class: 'muted' }, v?.error ?? (v ? `${v.name} · ${new Date(v.savedAt).toLocaleString('ko-KR')}` : '아직 저장본이 없습니다.')), this.b('이 저장본 불러오기', () => { choice = key; this.activeModal.close(true); }, '', { disabled: !v || !!v.error })));
      }
      body.append(this.h('p', { class: 'muted' }, '복원하면 원고·대화·미적용 제안·프롬프트 편집 초안을 불러옵니다. 캐릭터 본체나 저장된 프롬프트 설정에는 자동으로 반영하지 않습니다.'));
    }, [{ label: initial ? '저장본 유지하고 새로 시작' : '닫기', value: false }]);
    if (!choice) return;
    if (!initial && !await this.guardReplace()) return;
    await this.replaceSession(restoreSnapshot(this.slots[choice]));
    this.toast('저장본을 복원했습니다. 진행 중이던 LLM 요청은 다시 전송하지 않습니다.');
  }
  async saveHost() {
    assert(!this.ioBusy, '저장 작업이 진행 중입니다.');
    assert(this.started, '먼저 새 작업을 시작하거나 원고를 작성하세요.');
    assert(this.s.draft.name?.trim(), '캐릭터 이름을 입력하세요.');
    const fields = this.s.base ? FIELDS.filter(f => !equal(this.s.base[f], this.s.draft[f])) : FIELDS;
    if (this.s.targetId && !fields.length) return this.toast('저장할 원고 변경이 없습니다.');
    if (!await this.confirm(this.s.targetId ? '캐릭터에 저장할까요?' : '새 캐릭터로 등록할까요?', '변경 영역: ' + fields.map(f => fieldNames[f] ?? f).join(', ') + '\n제작 대화와 미적용 수정안은 캐릭터에 저장되지 않습니다.')) return;
    const captured = clone(this.s), revision = this.s.revision; this.ioBusy = true;
    try {
      let saved;
      if (captured.targetId) {
        const result = await saveExisting(this.api, captured);
        if (result.conflicts.length) { await this.dialog('다른 곳에서 수정한 내용과 충돌합니다', body => body.append(this.h('p', { class: 'warn' }, result.conflicts.join(', ')), this.h('p', { class: 'muted' }, '저장하지 않았습니다. 최신 캐릭터를 새로 불러오거나, 현재안을 charx로 내보내 비교해 주세요.'))); return; }
        saved = result.saved;
      } else saved = await saveNew(this.api, captured);
      if (this.s.sessionId === captured.sessionId) {
        this.s.targetId = saved.chaId; this.s.base = editable(saved);
        this.s.source = clone(saved); delete this.s.source.chats; delete this.s.source.chatFolders; delete this.s.source.chatPage;
        if (this.s.revision === revision) this.s.draft = { ...this.s.draft, ...editable(saved), chaId: saved.chaId };
        this.touch(false); this.render();
      }
      this.toast('캐릭터를 저장했습니다. 기존 대화와 편집하지 않은 필드는 유지했습니다.');
    } finally { this.ioBusy = false; }
  }
  file(accept) {
    return new Promise(resolve => {
      const input = this.h('input', { type: 'file', accept, style: 'display:none' }); this.doc.body.append(input);
      let settled = false;
      const done = value => { if (!settled) { settled = true; input.remove(); resolve(value); } };
      input.addEventListener('change', () => done(input.files[0] ?? null), { once: true });
      input.addEventListener('cancel', () => done(null), { once: true }); input.click();
    });
  }
  async chooseCharx() {
    const file = await this.file('.charx'); if (!file) return;
    assert(file.size <= 100 * 1024 * 1024, 'charx 파일은 100MiB 이하만 지원합니다.');
    if (!await this.guardReplace()) return;
    this.ioBusy = true;
    try {
      const data = new Uint8Array(await file.arrayBuffer()), imported = await importCharx(this.api, data);
      const session = newSession(); session.draft = imported.character; session.cardMeta = imported.cardMeta;
      await this.replaceSession(session); this.toast('charx를 새 제작 원고로 불러왔습니다.');
    } finally { this.ioBusy = false; }
  }
  async downloadCharx() {
    assert(!this.ioBusy, '다른 파일·저장 작업이 진행 중입니다.'); this.ioBusy = true;
    const char = clone(this.s.draft), meta = clone(this.s.cardMeta);
    try {
      const data = await exportCharx(this.api, char, meta), url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
      const a = this.h('a', { href: url, download: (char.name || 'character').replace(/[<>:"/\\|?*]/g, '_') + '.charx' });
      this.doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); this.toast('charx 다운로드를 요청했습니다.');
    } finally { this.ioBusy = false; }
  }
  confirm(title, text) { return this.dialog(title, body => body.append(this.h('p', { style: 'white-space:pre-wrap;line-height:1.8' }, text)), [{ label: '취소', value: false }, { label: '확인', value: true, kind: 'primary' }]); }
  dialog(title, populate, actions = [{ label: '닫기', value: null }]) {
    assert(!this.activeModal, '먼저 열려 있는 창을 닫아 주세요.');
    const h = this.h.bind(this), previousFocus = this.doc.activeElement;
    const overlay = h('div', { class: 'modal-overlay' }), headingId = 'dialog-' + uid();
    const modal = h('section', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': headingId });
    const body = h('div', { class: 'modalbody' }), footer = h('div', { class: 'modalfoot' });
    return new Promise((resolve, reject) => {
      let settled = false;
      const close = value => { if (settled) return; settled = true; overlay.remove(); this.activeModal = null; this.root.inert = false; previousFocus?.focus(); resolve(value); };
      this.activeModal = { close, body };
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(null); }
        if (event.key === 'Tab') {
          const nodes = [...modal.querySelectorAll('button:not(:disabled), input, textarea, select, summary, [tabindex="0"]')];
          const first = nodes[0], last = nodes.at(-1);
          if (event.shiftKey && this.doc.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && this.doc.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      };
      overlay.addEventListener('keydown', onKey);
      try {
        populate(body);
        for (const action of actions) footer.append(this.b(action.label, () => close(action.value), action.kind ?? ''));
        modal.append(h('div', { class: 'modalhead row between' }, h('h3', { id: headingId }, title), this.b('×', () => close(null), 'ghost small', { 'aria-label': '창 닫기' })), body, footer);
        overlay.append(modal); this.doc.body.append(overlay); this.root.inert = true;
        queueMicrotask(() => modal.querySelector('input, textarea, button')?.focus());
      } catch (error) { close(null); reject(error); }
    });
  }
}
