import { conflictFields, requestImages, validateRequestImages, withRequestImages, readRequestImage, REQUEST_IMAGE_MAX, candidatePackets, chunkOptions, CHUNK_MIN_TOKENS, CHUNK_MAX_TOKENS, CHUNK_HARD_MAX } from './core.js';
import { CSS } from './style.js';
import { VERSION, DEFAULT_INPUT_CHARS, MAX_INPUT_CHARS, INPUT_LIMIT_VERSION, migrateInputSettings, inputSize, loreSelection, loreSelectionAfterPacket, reconcileLoreSelection, validateLoreSelection, PREFIX, FIELDS, TASKS, clone, equal, uid, tick, assert, editable, blankCharacter, newSession, sessionFromCharacter, snapshot, restoreSnapshot, luaEntries, defaultPrompt, formatFor, composeMessages, parseResponse, applyPacket, mergeCharacter, listCharacters, saveExisting, saveNew, callModel, regexTest } from './core.js';
import { importCharx, exportCharx } from './charx.js';
import { newPresetState, validatePresetState, assemblePreset } from './preset-engine.js';
import { renderPresetEditor } from './preset-ui.js';
import { proposalDiff, removeAdditionalAssets, luaFirstTriggers, reviewPacket, withCharacterIcon, cbsIssues } from './core.js';
import { registerInterop, DA_WORKSHOP_INTEROP_MARK } from './interop.js';

const TABS = [['overview', '제작 노트'], ['description', '캐릭터 설명'], ['lorebook', '로어북'], ['regex', '정규식'], ['lua', 'Lua · 변수'], ['greeting', '첫 메시지'], ['assets', '에셋 목록'], ['preset', '프롬프트 프리셋', '프리셋']];
const TAB_FIELDS = { overview: ['name'], description: ['desc', 'personality', 'scenario', 'systemPrompt', 'postHistoryInstructions', 'exampleMessage', 'creatorNotes', 'creator', 'characterVersion', 'tags'], lorebook: ['globalLore'], regex: ['customscript'], lua: ['triggerscript', 'defaultVariables'], greeting: ['firstMessage', 'alternateGreetings'], assets: ['image', 'additionalAssets', 'ccAssets'] };
export const AUTOSAVE_KEYS = ['autosave', 'autosave-1', 'autosave-2'];
const SLOT_NAMES = { autosave: '자동 저장 · 최근', 'autosave-1': '자동 저장 · 1회 전', 'autosave-2': '자동 저장 · 2회 전', manual: '수동 임시 저장' };
const fieldNames = { name: '이름', image: '봇 아이콘', desc: '캐릭터 설명', globalLore: '로어북', customscript: '정규식', triggerscript: 'Lua·트리거', defaultVariables: '초기 변수', firstMessage: '첫 메시지', additionalAssets: '에셋 목록', ccAssets: '카드 에셋 참조' };
// What each request task may change; shown beside the input so the active task is never a guess.
const TASK_SCOPE = { workshop: '방향을 의논합니다. 제작·수정을 요청할 때만 작업별 수정안을 묶어 제안합니다.', description: '캐릭터 설명·성격·시나리오 본문을 작성·수정합니다.', lorebook: '로어북 항목을 추가·수정·삭제합니다.', regex: '정규식 규칙과 HTML/CSS 원문을 작성·수정합니다.', lua: 'Lua 코드와 초기 변수를 작성·수정합니다.', greeting: '첫 메시지를 작성·수정합니다.', choiceGreeting: '첫 메시지·상황 목록·변수·Lua·정규식을 한 묶음으로 작성합니다.' };
const SETTINGS = { model: 'submodel', timeout: 900, maxInputChars: DEFAULT_INPUT_CHARS, inputLimitVersion: INPUT_LIMIT_VERSION, theme: 'system', chunking: true, chunkTokens: 5000, chunkMax: 8 };

export class Workshop {
  fitRequestInput() {
    const input = this.requestInput;
    if (!input || !this.doc.defaultView?.matchMedia("(max-width: 840px)").matches) return;
    input.style.height = "52px";
    input.style.height = Math.min(122, Math.max(52, input.scrollHeight + 2)) + "px";
  }
  async showMobileMenu(header, tools, chat) {
    const buttons = [...tools.querySelectorAll(".toolbar-files button, .toolbar-saves button"), ...header.querySelectorAll(".header-actions button")];
    const chosen = await this.dialog("작업 메뉴", (body) => {
      body.append(this.h("p", { class: "muted" }, this.statusEl.textContent));
      const list = this.h("div", { class: "mobile-menu-list" });
      for (const button of buttons) list.append(this.b(button.textContent, () => this.activeModal.close(button), "", { disabled: button.disabled }));
      body.append(list, this.h("details", {}, this.h("summary", {}, "이미지 첨부 도움말"), this.h("p", { class: "muted" }, "캡처 파일을 첨부하거나 요청창에 이미지를 붙여넣으세요. PNG·JPG·WEBP 최대 4장, 장당 5MiB, 합계 12MiB입니다. 이미지 입력을 지원하는 모델을 사용하세요.")));
    });
    if (chosen && !this.job) chosen.click();
  }
  async addRequestImages(files) {
    assert(!this.job && !this.imageLoading, "요청 또는 이미지 처리가 진행 중입니다. 잠시 기다려 주세요.");
    const session = this.s, task = this.task;
    const previous = requestImages(session, task);
    assert(previous.length + files.length <= REQUEST_IMAGE_MAX, "이미지는 요청당 최대 4장까지 첨부할 수 있습니다.");
    if (!files.length) return;
    this.imageLoading = true;
    this.render();
    try {
      const added = [];
      for (const file of files) added.push(await readRequestImage(file, this.doc));
      const next = validateRequestImages([...previous, ...added]);
      assert(this.s === session && !this.job, "작업이 변경되어 이미지 첨부를 중단했습니다.");
      session.requestImages ??= {};
      session.requestImages[task] = next;
      this.touch(false);
    } finally {
      this.imageLoading = false;
      this.render();
    }
  }
  pasteRequestImages(event) {
    const clipboard = event.clipboardData;
    const items = [...clipboard?.items ?? []];
    const files = items.filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
    if (!files.length) files.push(...[...clipboard?.files ?? []].filter((file) => file.type.startsWith("image/")));
    if (!files.length) return;
    event.preventDefault();
    if (this.job || this.imageLoading) {
      this.toast("이미지 또는 요청 처리 중입니다. 잠시 후 다시 붙여넣으세요.", true);
      return;
    }
    const text = clipboard.getData("text/plain");
    if (text) {
      this.requestInput.setRangeText(text, this.requestInput.selectionStart, this.requestInput.selectionEnd, "end");
      this.s.requests[this.task] = this.requestInput.value;
      this.touch(false);
    }
    this.addRequestImages(files).catch((error) => this.toast(error.message, true));
  }
  requestImageComposer() {
    const h = this.h.bind(this), session = this.s, task = this.task;
    const host = h("div", { class: "stack request-images", style: "gap:8px" });
    const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: "", style: "display:none", "aria-label": "요청에 이미지 첨부" });
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      this.addRequestImages(files).catch((error) => this.toast(error.message, true));
    });
    host.append(input, this.b(this.imageLoading ? "읽는 중…" : this.doc.defaultView?.matchMedia("(max-width: 840px)").matches ? "＋ 이미지" : "＋ 이미지 첨부", () => input.click(), "small", { disabled: !!this.job || !!this.imageLoading, title: "캡처 이미지를 첨부하거나 입력창에 붙여넣으세요. PNG·JPG·WEBP, 최대 4장 / 장당 5MiB / 합계 12MiB. 이미지 지원 모델이 필요합니다." }));
    const previews = h("div", { class: "request-previews", style: "display:flex;gap:8px;flex-wrap:wrap;min-width:0" });
    for (const image of requestImages(session, task)) previews.append(h("div", { class: "card stack", style: "width:150px;max-width:100%;gap:6px" }, h("img", { src: image.data, alt: image.name, style: "width:100%;height:110px;object-fit:contain" }), h("span", { style: "overflow-wrap:anywhere" }, image.name), this.b("첨부 삭제", () => {
      if (this.job || this.imageLoading) return;
      session.requestImages[task] = requestImages(session, task).filter((item) => item.id !== image.id);
      this.touch(false);
      this.render();
    }, "small", { disabled: !!this.imageLoading })));
    host.append(previews);
    return host;
  }
  async reviewSaveConflicts(session, result) {
    const h = this.h.bind(this), fields = conflictFields(result), choices = {};
    return this.dialog("저장할 내용 비교", (body) => {
      body.append(h("p", { class: "warn" }, "항목을 자동으로 구분할 수 없거나 리스의 현재 내용과 충돌합니다. 각 영역에서 저장할 쪽을 선택하세요. 로어북에서 봇빌더 원고를 선택하면 해당 로어북 목록 전체를 원고 내용으로 교체합니다. 리스에만 있던 변경은 포함되지 않을 수 있습니다."), h("p", { class: "muted" }, "선택하지 않은 상태에서는 저장하지 않습니다. 충돌하지 않는 수정은 기존 방식으로 반영하며, 채팅 기록은 유지합니다."));
      const display = (value) => value === void 0 ? "(없음)" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
      for (const field of fields) {
        const label = fieldNames[field] ?? field;
        const count = (value) => Array.isArray(value) ? " · " + value.length + "개" : "";
        body.append(h(
          "section",
          { class: "card stack" },
          h("h3", {}, label),
          h("details", {}, h("summary", {}, "처음 불러왔던 내용" + count(session.base[field])), h("pre", { class: "diff" }, display(session.base[field]))),
          h("details", { open: "" }, h("summary", {}, "리스의 현재 내용" + count(result.current[field])), h("pre", { class: "diff" }, display(result.current[field]))),
          h("details", { open: "" }, h("summary", {}, "봇빌더 원고" + count(session.draft[field])), h("pre", { class: "diff" }, display(session.draft[field]))),
          this.select("", [["", "저장할 쪽을 선택하세요"], ["draft", "봇빌더 원고로 이 영역 전체 교체"], ["current", "리스의 현재 내용 유지"]], (value) => {
            choices[field] = value;
          }, label + " 저장 방식")
        ));
      }
      body.append(this.b("선택한 내용으로 저장", () => {
        if (!fields.length || !fields.every((field) => ["draft", "current"].includes(choices[field]))) {
          this.toast("모든 충돌 영역에서 저장할 쪽을 선택하세요.", true);
          return;
        }
        this.activeModal.close({ ...choices });
      }, "primary"));
    }, [{ label: "취소 · 원고 유지", value: null }]);
  }
  constructor(api, doc) {
    this.api = api; this.doc = doc; this.s = newSession(); this.prompts = {}; this.settings = { ...SETTINGS };
    this.s.preset = newPresetState(); this.savedPreset = null;
    this.started = false; this.serial = 0; this.autoSerial = 0; this.slots = {}; this.slotRaw = {}; this.ioBusy = false; this.job = null;
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
  // Navigation-only state (tab, list selection, model choice) never starts a session or marks the draft edited.
  navigate() { if (this.started) this.serial++; this.status(); }
  setField(key, value) { this.s.draft[key] = value; this.touch(); }
  presetChanged() { this.s.promptRevision++; this.touch(false); }
  dirty() { return this.s.targetId ? !equal(this.s.base, editable(this.s.draft)) : this.started; }
  toast(message, bad = false) {
    this.toastEl?.remove(); clearTimeout(this.toastTimer);
    const toast = this.h('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status' }, this.h('span', { class: 'toast-text' }, message));
    // Error toasts stay until closed so long messages can be read and copied; notices fade on their own.
    if (bad) toast.append(this.b('닫기', () => toast.remove(), 'small toast-close', { 'aria-label': '오류 안내 닫기' }));
    else this.toastTimer = setTimeout(() => toast.remove(), 7000);
    this.toastEl = toast; this.doc.body.append(toast);
  }
  async init() {
    const style = this.h("style", {}, CSS);
    this.doc.head.append(style);
    this.doc.documentElement.lang = "ko";
    this.root = this.h("main", { id: "story-workshop" });
    for (const type of ["click", "beforeinput", "input", "change", "keydown", "drop"]) this.root.addEventListener(type, (event) => {
      if (!this.job || event.target.closest?.('[data-action="cancel-request"]')) return;
      if (type === "keydown" && !["Enter", " ", "Backspace", "Delete"].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    this.doc.body.append(this.root);
    const viewport = this.doc.defaultView?.visualViewport;
    this.updateViewport = () => {
      if (!viewport) return;
      this.root.style.setProperty("--workshop-vheight", viewport.height + "px");
      this.root.style.setProperty("--workshop-vtop", viewport.offsetTop + "px");
    };
    viewport?.addEventListener("resize", this.updateViewport);
    viewport?.addEventListener("scroll", this.updateViewport);
    this.updateViewport();
    const setting = await this.api.pluginStorage.getItem(PREFIX + "settings");
    try {
      if (setting) {
        const saved = JSON.parse(setting);
        this.settings = { ...SETTINGS, ...saved, ...migrateInputSettings(saved) };
        if (saved.inputLimitVersion !== INPUT_LIMIT_VERSION && saved.timeout === 300) this.settings.timeout = 900;
      }
    } catch {
    }
    if (!["model", "submodel"].includes(this.settings.model)) this.settings.model = "submodel";
    if (!Number.isFinite(this.settings.timeout) || this.settings.timeout < 10 || this.settings.timeout > 3600) this.settings.timeout = 900;
    Object.assign(this.settings, migrateInputSettings(this.settings));
    if (!["system", "light", "dark"].includes(this.settings.theme)) this.settings.theme = "system";
    Object.assign(this.settings, chunkOptions(this.settings));
    this.themeMedia = this.doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
    this.themeListener = () => this.applyTheme();
    this.themeMedia?.addEventListener("change", this.themeListener);
    // Re-render when crossing the mobile breakpoint (rotation, split screen) so layout-dependent parts update.
    this.layoutMedia = this.doc.defaultView?.matchMedia?.("(max-width: 840px)");
    // Skip when a click already re-rendered at the new width, so the DOM is not replaced twice.
    this.layoutListener = () => { if (!this.job && this.renderedMobile !== !!this.layoutMedia?.matches) this.render(); };
    this.layoutMedia?.addEventListener?.("change", this.layoutListener);
    this.applyTheme();
    await Promise.all(Object.keys(TASKS).map(async (task) => {
      const raw = await this.api.pluginStorage.getItem(PREFIX + "prompt:" + task);
      try {
        if (raw) {
          const p = JSON.parse(raw);
          if (typeof p.system === "string" && typeof p.user === "string") this.prompts[task] = p;
        }
      } catch {
      }
    }));
    const savedPreset = await this.api.pluginStorage.getItem(PREFIX + "preset-workspace");
    if (savedPreset) {
      try {
        this.savedPreset = validatePresetState(typeof savedPreset === "string" ? JSON.parse(savedPreset) : savedPreset);
        this.s.preset = clone(this.savedPreset);
      } catch (error) {
        this.toast("프리셋 설정을 불러오지 못했습니다. 저장된 원본은 유지했습니다: " + error.message, true);
      }
    }
    await this.readSlots();
    this.render();
    const open = async () => {
      await this.api.showContainer("fullscreen");
      this.render();
      if (!this.opened) {
        this.opened = true;
        if (Object.values(this.slots).some(Boolean)) await this.showRecovery(true);
      }
    };
    await this.api.registerSetting("봇빌더", open, "BB", "html");
    await this.api.registerButton({ name: "봇빌더", icon: "BB", iconType: "html", location: "hamburger" }, open);
    // Dusk Atelier integration (DA Interop v1). Read-only toward 봇빌더: it may open the screen and read the draft, nothing else.
    // Not awaited so slow or failing storage never blocks startup; the marker string must survive the build (checked in tools/build.mjs).
    this.interopReady = registerInterop(this.api.pluginStorage, {
      id: "risu-story-workshop", name: "봇빌더", version: VERSION, pluginName: "risu_story_workshop",
      description: "Dusk Atelier에서 봇빌더 화면을 열고, 작업 중인 원고를 넘겨받아요.",
      actions: [
        { key: "open", label: "봇빌더 열기", run: async () => { await open(); return { opened: true }; } },
        { key: "draft", label: "작업 중인 원고 보내기", run: async () => this.draftForInterop() },
      ],
    }).then((handle) => { this.interop = handle; if (this.destroyed) handle?.stop(); return handle; }).catch((error) => { console.warn("[봇빌더] DA Interop 등록 실패 " + DA_WORKSHOP_INTEROP_MARK, error); return null; });
    this.autoTimer = setInterval(() => this.autosave().catch((error) => this.toast("자동 저장 실패: " + error.message, true)), 18e4);
    this.elapsedTimer = setInterval(() => this.jobStatus(), 1e3);
    await this.api.onUnload(() => this.destroy());
  }
  // Snapshot handed to Dusk Atelier: editable fields only, never chats or the host id.
  draftForInterop() {
    if (!this.s?.draft) return null;
    return { name: String(this.s.draft.name ?? ""), targetId: this.s.targetId ?? null, started: !!this.started, dirty: !!this.dirty(), savedAt: this.slots.autosave?.savedAt ?? null, draft: editable(this.s.draft) };
  }
  destroy() {
    this.destroyed = true;
    this.interop?.stop();
    this.doc.defaultView?.visualViewport?.removeEventListener("resize", this.updateViewport);
    this.doc.defaultView?.visualViewport?.removeEventListener("scroll", this.updateViewport);
    clearInterval(this.autoTimer);
    clearInterval(this.elapsedTimer);
    clearTimeout(this.toastTimer);
    this.themeMedia?.removeEventListener("change", this.themeListener);
    this.layoutMedia?.removeEventListener?.("change", this.layoutListener);
    this.job?.stop?.();
    this.activeModal?.close(null);
  }
  applyTheme() { this.doc.documentElement.dataset.theme = this.settings.theme === 'system' ? this.themeMedia?.matches ? 'dark' : 'light' : this.settings.theme; }
  async readSlots() {
    for (const name of [...AUTOSAVE_KEYS, 'manual']) {
      const raw = await this.api.pluginStorage.getItem(PREFIX + name);
      this.slotRaw[name] = raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)) : null;
      if (!raw) { this.slots[name] = null; continue; }
      try { const s = restoreSnapshot(raw); if(s.preset)s.preset=validatePresetState(s.preset); const v = typeof raw === 'string' ? JSON.parse(raw) : raw; this.slots[name] = { ...v, session: s }; }
      catch (error) { this.slots[name] = { error: error.message, name: '읽을 수 없는 저장본' }; }
    }
  }
  async store(key, data) { return this.storeRaw(key, JSON.stringify(data)); }
  async storeRaw(key, text) {
    const work = this.storageQueue.catch(() => {}).then(() => text === null ? this.api.pluginStorage.removeItem(PREFIX + key) : this.api.pluginStorage.setItem(PREFIX + key, text));
    this.storageQueue = work; await work;
  }
  // Keeps the three most recent automatic saves: autosave → autosave-1 → autosave-2.
  async rotateAutosaves() {
    for (let i = AUTOSAVE_KEYS.length - 1; i > 0; i--) {
      const from = AUTOSAVE_KEYS[i - 1], to = AUTOSAVE_KEYS[i], raw = this.slotRaw[from] ?? null;
      if (raw === (this.slotRaw[to] ?? null)) continue;
      await this.storeRaw(to, raw); this.slotRaw[to] = raw; this.slots[to] = raw ? this.slots[from] : null;
    }
  }
  async saveSlot(name) {
    assert(this.started, '새 작업을 시작하거나 원고를 불러온 뒤 저장해 주세요.');
    this.s.requestSettings = { ...this.settings, task: this.task, scopeOnly: this.scopeOnly };
    const serial = this.serial, value = snapshot(this.s), text = JSON.stringify(value);
    if (name === 'autosave') await this.rotateAutosaves();
    await this.storeRaw(name, text); this.slots[name] = value; this.slotRaw[name] = text;
    if (name === 'autosave') this.autoSerial = serial;
    this.status();
  }
  async autosave() { if (this.started && this.serial !== this.autoSerial) await this.saveSlot('autosave'); }
  status() {
    if (!this.statusEl) return;
    const date = key => this.slots[key]?.savedAt ? new Date(this.slots[key].savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '없음';
    this.statusEl.textContent = `${this.dirty() ? '원고 편집 중' : '변경 없음'} · 자동 저장 ${date('autosave')} · 임시 저장 ${date('manual')}`;
    if (this.mobileStatusEl) this.mobileStatusEl.textContent = `${this.dirty() ? '편집 중' : '변경 없음'} · 자동 ${date('autosave')} · 임시 ${date('manual')}`;
    if (this.titleEl) this.titleEl.textContent = this.s.draft.name || '이름 없는 이야기';
    const undoBar = this.root?.querySelector('.undo-bar');
    if (undoBar) undoBar.hidden = !this.undoAvailable();
    const changed = this.changedTabs();
    for (const item of this.root?.querySelectorAll('.navitem[data-tab]') ?? []) {
      const tab = item.dataset.tab, count = item.querySelector('.navcount');
      if (count) count.textContent = tab === 'lorebook' ? this.s.draft.globalLore?.length ?? 0 : tab === 'regex' ? this.s.draft.customscript?.length ?? 0 : '';
      item.dataset.changed = String(changed.has(tab));
    }
  }
  // Tabs whose fields differ from the loaded character, or from a blank draft for new work.
  changedTabs() {
    const base = this.s.base ?? editable(blankCharacter()), draft = editable(this.s.draft);
    return new Set(Object.entries(TAB_FIELDS).filter(([, fields]) => fields.some(f => !equal(base[f], draft[f]))).map(([tab]) => tab));
  }
  jobStatus() {
    if (this.regexStatusEl?.isConnected) this.regexStatusEl.textContent = this.regexJob ? `텍스트 검사 중 · ${Math.floor((Date.now() - this.regexJob.start) / 1000)}초` : '';
    if (!this.jobEl) return;
    this.jobEl.replaceChildren();
    if (this.job) this.jobEl.append(this.h('span', { class: 'spinner', 'aria-hidden': 'true' }), this.doc.createTextNode(`${this.job.label} · ${Math.floor((Date.now() - this.job.start) / 1000)}초`), this.doc.defaultView?.matchMedia?.('(max-width: 840px)').matches ? this.h('span', { class: 'job-hint' }, ' · 화면을 켜 두세요. 꺼지면 응답이 끊길 수 있습니다.') : null);
    else this.jobEl.textContent = '메인·보조 모델은 리스바드 설정을 사용합니다.';
  }
  lockRequestEditors() {
    if (!this.root) return;
    this.root.setAttribute('aria-busy', String(!!this.job));
    if (!this.job) return; // Normal rendering restores each control's own disabled state.
    for (const control of this.root.querySelectorAll('input, textarea, select, button')) {
      if (control.getAttribute('data-action') !== 'cancel-request') control.disabled = true;
    }
    for (const editable of this.root.querySelectorAll('[contenteditable="true"]')) editable.setAttribute('contenteditable', 'false');
  }
  cancelRequest() {
    if (!this.job) return;
    this.job.cancelled = true;
    this.job.stop?.();
    this.activeModal?.close(null);
  }
  render() {
    const h = this.h.bind(this), s = this.s;
    this.statusEl = h("span", { class: "status-text", "aria-live": "polite" });
    this.titleEl = h("strong", { class: "document-name", title: s.draft.name }, s.draft.name);
    const header = h(
      "header",
      { class: "topbar" },
      h("div", { class: "brand" }, h("div", { class: "brandmark", "aria-hidden": "true" }, "BB"), h("div", { class: "stack", style: "gap:4px" }, h("span", { class: "eyebrow" }, "BOT BUILDER"), h("h1", {}, "봇빌더"))),
      h("div", { class: "row document-title" }, this.titleEl, h("span", { class: "pill" }, s.targetId ? "기존 캐릭터" : "새 제작 원고")),
      h("div", { class: "row header-actions" }, this.statusEl, this.b("설정", () => this.showSettings(), "ghost small"), this.b("닫기", () => this.api.hideContainer(), "ghost small"))
    );
    const tools = h("div", { class: "toolbar" }, h("div", { class: "toolbar-files" }, this.b("＋ 새 작업", () => this.newWork()), this.b("캐릭터 불러오기", () => this.loadCharacters()), this.b("charx 열기", () => this.chooseCharx())), h("div", { class: "toolbar-saves" }, this.b("임시 저장", async () => {
      await this.saveSlot("manual");
      this.toast("수동 임시 저장본을 갱신했습니다.");
    }), this.b("저장본 불러오기", () => this.showRecovery()), this.b("charx 내보내기", () => this.downloadCharx()), this.b(s.targetId ? "캐릭터에 저장" : "새 캐릭터로 저장", () => this.saveHost(), "primary")), h("div", { class: "mobile-switch" }, this.b("원고", () => {
      this.view = "editor";
      this.render();
    }, "small", { "aria-pressed": this.view === "editor" }), this.b("대화", () => {
      this.view = "chat";
      this.render();
    }, "small", { "aria-pressed": this.view === "chat" })));
    this.editor = h("section", { class: "editor", "aria-label": "제작 원고" });
    const sidebar = h("nav", { class: "sidebar", "aria-label": "원고 구성" }, h("span", { class: "eyebrow" }, "MANUSCRIPT"), TABS.map(([id, name, short], i) => this.b([h("span", { class: "navnum" }, String(i + 1).padStart(2, "0")), h("span", { class: "navlabel" }, short ?? name), h("span", { class: "navmeta" }, h("span", { class: "navdot", title: "원본과 다른 내용이 있습니다", "aria-label": "변경됨" }), h("span", { class: "navcount" }, ""))], () => {
      s.tab = id;
      if (Object.hasOwn(TASKS, id)) this.task = id;
      this.view = "editor";
      this.navigate();
      this.render();
    }, "navitem", { "aria-current": s.tab === id ? "page" : null, "data-tab": id })), h("div", { class: "sidefoot muted" }, "대화로 구상하고,\n원고로 구체화하세요.", h("p", { style: "margin-top:12px" }, `v${VERSION} · 3분 자동 저장`)));
    const chat = this.renderChat();
    // Mobile tab strip: flag when more tabs are hidden to the right so the fade hint shows.
    const trackOverflow = () => { sidebar.dataset.overflow = String(sidebar.scrollLeft + sidebar.clientWidth < sidebar.scrollWidth - 1); };
    sidebar.addEventListener("scroll", trackOverflow, { passive: true });
    this.sidebarOverflow = trackOverflow;
    this.workspace = h("div", { class: "workspace", "data-view": this.view }, sidebar, this.editor, chat);
    if (this.job) header.append(h("span", { class: "warn", role: "status" }, "응답 처리 중 · 편집 잠금"), this.b("요청 취소", () => this.cancelRequest(), "danger small", { "data-action": "cancel-request" }));
    this.mobileStatusEl = h("span", { class: "mobile-status", "aria-live": "polite" });
    const mobileTop = h("header", { class: "mobile-top" }, h("div", { class: "mobile-title" }, h("strong", { class: "document-name", title: s.draft.name }, s.draft.name || "봇빌더"), this.mobileStatusEl), ...["editor", "chat"].map((view) => this.b(view === "editor" ? "원고" : "대화", () => {
      this.view = view;
      this.render();
    }, "", { "aria-pressed": this.view === view })), this.job ? this.b("취소", () => this.cancelRequest(), "danger small", { "data-action": "cancel-request", "aria-label": "요청 취소" }) : this.b("☰", () => this.showMobileMenu(header, tools, chat), "", { "aria-label": "작업 메뉴" }));
    this.root.replaceChildren(header, tools, mobileTop, this.workspace);
    this.renderEditor();
    this.status();
    this.jobStatus();
    this.lockRequestEditors();
    this.sidebarOverflow();
    this.doc.defaultView?.requestAnimationFrame?.(() => this.sidebarOverflow?.());
    this.renderedMobile = !!this.doc.defaultView?.matchMedia?.("(max-width: 840px)").matches;
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
      const draw = () => list.replaceChildren(...alts.map((a, i) => h('div', { class: 'card stack' }, this.field(`대체 인사말 ${i + 1}`, a, v => { alts[i] = v; s.draft.alternateGreetings = alts; this.touch(); }), this.b('삭제', () => { alts.splice(i, 1); s.draft.alternateGreetings = alts; this.touch(); draw(); }, 'small danger')))); draw();
      body.append(h('details', {}, h('summary', {}, `대체 인사말 ${alts.length}개`), list, this.b('대체 인사말 추가', () => { alts.push(''); s.draft.alternateGreetings = alts; this.touch(); draw(); }, 'small')),
        h('p', { class: 'muted' }, '시작 상황 선택 요청은 첫 메시지·Lua·변수·필요 정규식을 묶어서 제안합니다.'));
      this.editorAction(body, 'greeting'); this.editorAction(body, 'choiceGreeting');
    } else if (s.tab === 'assets') this.renderAssets(body);
    else if (s.tab === 'preset') renderPresetEditor(this,body);
    this.lockRequestEditors();
  }
  editorAction(host, task) {
    host.append(this.h('div', { class: 'row' }, this.b('LLM과 ' + TASKS[task].label + ' 다듬기', () => { this.task = task; this.view = 'chat'; this.render(); this.requestInput?.focus(); }), this.b('프롬프트', () => this.showPrompt(task), 'small')));
  }
  renderList(host, task) {
    const h = this.h.bind(this), s = this.s, lore = task === "lorebook", field = lore ? "globalLore" : "customscript";
    s.draft[field] ??= [];
    const list = s.draft[field];
    const selected = Math.min(Math.max(s.selected[task] ?? 0, 0), Math.max(list.length - 1, 0));
    s.selected[task] = selected;
    if (lore) s.loreIncluded = loreSelection(s);
    const redrawLoreList = () => {
      const scrollTop = nav.scrollTop;
      const editorScrollTop = this.editor?.scrollTop ?? 0;
      this.renderEditor();
      if (this.editor) this.editor.scrollTop = editorScrollTop;
      const replacement = this.editor?.querySelector(".lore-request-list");
      if (replacement) replacement.scrollTop = scrollTop;
    };
    const inclusionChanged = () => {
      this.s.promptRevision++;
      this.touch(false);
      redrawLoreList();
    };
    if (lore) host.append(h("div", { class: "card stack" },
      h("strong", {}, `이번 요청에 포함할 로어북 · ${s.loreIncluded.filter(Boolean).length}/${list.length}개`),
      h("p", { class: "muted" }, "체크한 현재 원고 항목만 직접·프리셋 요청에 포함합니다. 원본과 ‘항상 활성화’ 설정은 유지됩니다. 이전 대화에 이미 적힌 내용은 유지되며, 설치 모듈의 로어북은 프리셋 > 모듈에서 별도로 선택합니다."),
      h("div", { class: "row" }, this.b("전체 포함", () => { s.loreIncluded = list.map(() => true); inclusionChanged(); }, "small"), this.b("전체 제외", () => { s.loreIncluded = list.map(() => false); inclusionChanged(); }, "small"))
    ));
    const nav = h("div", { class: "itemlist" + (lore ? " lore-request-list" : ""), "aria-label": lore ? "요청 로어북 목록" : "항목 목록" }, list.map((x, i) => {
      const title = x.comment || `항목 ${i + 1}`;
      const button = h("button", {
        type: "button", class: "listitem" + (i === selected ? " active" : ""), title,
        "aria-current": i === selected ? "true" : null,
        onclick: () => {
          s.selected[task] = i;
          this.navigate();
          if (lore) redrawLoreList();
          else this.renderEditor();
        }
      }, lore ? `${i + 1}. ${title}` : title);
      if (!lore) return button;
      const toggle = this.check("이번 요청에 포함", s.loreIncluded[i], (included) => {
        s.loreIncluded[i] = included;
        inclusionChanged();
      });
      toggle.className = "row muted lore-request-toggle";
      toggle.setAttribute("title", `${i + 1}. ${title} · 이번 요청에 포함`);
      return h("div", { class: "lore-request-item" + (i === selected ? " is-selected" : "") }, button, toggle);
    }));
    const edit = h("div", { class: "stack" }), item = list[selected];
    host.append(h("div", { class: "row" }, this.b("＋ 항목 추가", () => {
      list.push(lore ? { key: "", secondkey: "", content: "", comment: "새 로어", insertorder: 100, mode: "normal", alwaysActive: false, selective: false } : { comment: "새 규칙", in: "", out: "", type: "editdisplay", flag: "g", ableFlag: true });
      if (lore) s.loreIncluded.push(true);
      s.selected[task] = list.length - 1;
      this.touch();
      this.renderEditor();
    }, "small"), h("span", { class: "muted" }, `${list.length}개 항목`)), h("div", { class: "list-editor" }, nav, edit));
    if (!item) edit.append(h("div", { class: "empty" }, "항목을 추가하거나 LLM에게 작성을 요청하세요."));
    else {
      const change = (key2, value) => {
        item[key2] = value;
        this.touch();
      };
      edit.append(this.field("항목 이름", item.comment, (v) => change("comment", v), { tag: "input" }));
      if (lore) edit.append(this.field("키워드 · 쉼표 구분", item.key, (v) => change("key", v), { tag: "input" }), this.field("본문", item.content, (v) => change("content", v), { style: "min-height:260px" }), h("div", { class: "grid2" }, this.field("보조 키워드", item.secondkey, (v) => change("secondkey", v), { tag: "input" }), this.field("삽입 순서", item.insertorder, (v) => change("insertorder", Number(v)), { tag: "input", type: "number" })), h("div", { class: "row" }, this.check("항상 활성화", item.alwaysActive, (v) => change("alwaysActive", v)), this.check("보조 키워드 사용", item.selective, (v) => change("selective", v)), this.check("키워드를 정규식으로", item.useRegex, (v) => change("useRegex", v))), h("label", { class: "field" }, h("span", {}, "모드"), this.select(item.mode, ["normal", "multiple", "constant", "child", "folder"].map((v) => [v, v]), (v) => change("mode", v), "로어북 모드")));
      else {
        edit.append(this.field("IN · 찾을 패턴", item.in, (v) => change("in", v), { class: "code", style: "min-height:90px" }), this.field("OUT · 치환문 / HTML·CSS 원문", item.out, (v) => change("out", v), { class: "code", style: "min-height:230px" }), h("div", { class: "grid2" }, h("label", { class: "field" }, h("span", {}, "적용 유형"), this.select(item.type, [["editinput", "입력"], ["editoutput", "출력"], ["editprocess", "처리"], ["editdisplay", "표시"]], (v) => change("type", v), "정규식 적용 유형")), this.field("플래그", item.flag, (v) => change("flag", v), { tag: "input" })), this.check("지정한 플래그 사용 · 끄면 기본 g", item.ableFlag, (v) => change("ableFlag", v)));
        const result = h("div", { class: "stack testresult", "aria-live": "polite" });
        this.regexStatusEl = h("p", { class: "muted", role: "status" });
        edit.append(
          h("hr", { class: "ruled" }),
          h("h3", {}, "정규식 텍스트 테스트"),
          this.field("테스트 입력", s.regexInput, (v) => {
            s.regexInput = v;
            this.touch(false);
          }, { class: "code" }),
          h("div", { class: "row" }, this.b("매칭·치환 테스트", async () => {
            assert(!this.regexJob, "정규식 테스트가 진행 중입니다.");
            const job = { cancelled: false, start: Date.now() };
            this.regexJob = job;
            this.jobStatus();
            try {
              const r = await regexTest(clone(item), s.regexInput, job);
              result.replaceChildren(h("p", { class: r.limited ? "warn" : "muted" }, `${r.matches.length}개 매칭 · ${r.note}`), h("h3", {}, "치환 결과"), h("pre", { class: "diff" }, r.output), h("details", {}, h("summary", {}, "매칭 위치 · 캡처 그룹"), h("pre", { class: "diff" }, JSON.stringify(r.matches, null, 2))));
            } finally {
              this.regexJob = null;
              this.jobStatus();
            }
          }, "small"), this.b("테스트 중단", () => {
            if (this.regexJob) this.regexJob.cancelled = true;
          }, "small")),
          this.regexStatusEl,
          result
        );
      }
      edit.append(h("div", { class: "row" }, this.b("위로", () => {
        if (selected > 0) {
          [list[selected - 1], list[selected]] = [list[selected], list[selected - 1]];
          if (lore) [s.loreIncluded[selected - 1], s.loreIncluded[selected]] = [s.loreIncluded[selected], s.loreIncluded[selected - 1]];
          s.selected[task]--;
          this.touch();
          this.renderEditor();
        }
      }, "small"), this.b("아래로", () => {
        if (selected + 1 < list.length) {
          [list[selected + 1], list[selected]] = [list[selected], list[selected + 1]];
          if (lore) [s.loreIncluded[selected + 1], s.loreIncluded[selected]] = [s.loreIncluded[selected], s.loreIncluded[selected + 1]];
          s.selected[task]++;
          this.touch();
          this.renderEditor();
        }
      }, "small"), this.b("항목 삭제", async () => {
        if (await this.confirm("항목을 삭제할까요?", item.comment || "선택 항목")) {
          list.splice(selected, 1);
          if (lore) s.loreIncluded.splice(selected, 1);
          this.touch();
          this.renderEditor();
        }
      }, "small danger")));
    }
    this.editorAction(host, task);
  }
  renderLua(host) {
    const h = this.h.bind(this), s = this.s;
    host.append(this.field('초기 변수 · 한 줄에 key=value', s.draft.defaultVariables, v => this.setField('defaultVariables', v), { class: 'code', placeholder: 'scene=none\ntrust=0' }));
    const entries = luaEntries(s.draft);
    host.append(h('div', { class: 'row' }, this.b('＋ Lua 추가', () => { s.draft.triggerscript.push({ comment: '새 Lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: '-- RisuAI Lua\n' }] }); s.draft.triggerscript = luaFirstTriggers(s.draft.triggerscript); this.touch(); this.renderEditor(); }, 'small'), h('span', { class: 'muted' }, `${entries.length}개 Lua · 전체 트리거 ${(s.draft.triggerscript ?? []).length}개`)));
    host.append(h("p", { class: "muted" }, "CHARX 저장 시 Lua 트리거를 맨 앞으로 배치해 리스에서 Lua 편집기로 인식하도록 합니다. 여러 Lua와 V2 트리거는 모두 보존되지만, 리스 기본 Lua 편집기에는 첫 번째 Lua만 표시됩니다. 전체 스크립트는 이 탭에서 편집하세요."));
    for (const e of entries) {
      const t = s.draft.triggerscript[e.ti];
      host.append(h('div', { class: 'card stack' }, this.field('Lua 이름', t.comment, v => { t.comment = v; this.touch(); }, { tag: 'input' }), h('label', { class: 'field' }, h('span', {}, '트리거 유형'), this.select(t.type, ['start', 'manual', 'input', 'output', 'display', 'request'].map(v => [v, v]), v => { t.type = v; this.touch(); }, '트리거 유형')), this.field('Lua 코드', e.code, v => { t.effect[e.ei].code = v; this.touch(); }, { class: 'code', style: 'min-height:280px' }), h('details', {}, h('summary', {}, '보존 중인 조건·효과 구조'), h('pre', { class: 'diff' }, JSON.stringify({ conditions: t.conditions, effectTypes: t.effect.map(x => x.type) }, null, 2))), this.b('이 Lua 효과 삭제', async () => { if (await this.confirm('Lua 효과를 삭제할까요?', '다른 효과와 트리거 조건은 유지됩니다.')) { t.effect.splice(e.ei, 1); if (!t.effect.length) s.draft.triggerscript.splice(e.ti, 1); this.touch(); this.renderEditor(); } }, 'small danger')));
    }
    if (!entries.length) host.append(h('div', { class: 'empty' }, 'Lua 코드를 추가하거나 LLM에게 변수·이벤트 작성을 요청하세요.'));
    this.editorAction(host, 'lua');
  }
  renderAssets(host) {
    const h = this.h.bind(this), s = this.s, list = s.draft.additionalAssets ??= [];
    host.append(h('section', { class: 'card stack', 'aria-label': '봇 아이콘' },
      h('h3', {}, '봇 아이콘 · 대표 이미지'),
      h('p', { class: 'muted', 'data-icon-status': '' }, s.draft.image ? '봇 아이콘이 등록되어 있습니다.' : '등록된 봇 아이콘이 없습니다.'),
      h('div', { class: 'row' }, this.b(s.draft.image ? '봇 아이콘 교체' : '봇 아이콘 등록', () => this.editIcon(), 'small'),
        this.b('봇 아이콘 해제', () => this.editIcon(true), 'small danger', { disabled: !s.draft.image })),
      h('p', { class: 'muted' }, '이미지 파일 20MiB 이하. 원고 저장·charx 내보내기에 반영하며, 아래 추가 에셋의 전체 삭제와는 별개입니다.')));
    host.append(h('h3', {}, '추가 에셋'));
    this.assetSelection = new Set(list.filter(entry => this.assetSelection?.has(entry)));
    const selection = this.assetSelection, boxes = [], count = h('span', { class: 'muted', role: 'status', 'data-asset-count': '' });
    const remove = this.b('선택 삭제', () => this.deleteAssets([...selection]), 'small danger', { disabled: !selection.size });
    const refresh = () => {
      count.textContent = `${list.length}개 중 ${selection.size}개 선택`;
      remove.disabled = !selection.size;
      for (const [box, entry] of boxes) box.checked = selection.has(entry);
    };
    host.append(h('p', { class: 'muted' }, '등록 해제는 이 원고의 참조만 제거합니다. 공유될 수 있는 실제 파일은 삭제하지 않습니다.'));
    host.append(h('div', { class: 'row' },
      this.b('전체 선택', () => { list.forEach(entry => selection.add(entry)); refresh(); }, 'small', { disabled: !list.length }),
      this.b('선택 해제', () => { selection.clear(); refresh(); }, 'small', { disabled: !list.length }), remove,
      this.b('전체 삭제', () => this.deleteAssets([...list]), 'small danger', { disabled: !list.length }), count));
    const names = new Set();
    for (const [i, tuple] of list.entries()) {
      const duplicate = names.has(tuple[0]); names.add(tuple[0]);
      const box = h('input', { type: 'checkbox', checked: selection.has(tuple), 'aria-label': `에셋 ${i + 1} 선택`, onChange: e => { if (e.target.checked) selection.add(tuple); else selection.delete(tuple); refresh(); } });
      boxes.push([box, tuple]);
      host.append(h('div', { class: 'card stack', 'data-asset-row': '' },
        h('label', { class: 'row muted', style: 'min-height:44px;cursor:pointer' }, box, `${i + 1}. 에셋 선택`),
        h('div', { class: 'assetrow' }, this.h('input', { value: tuple[0], 'aria-label': `에셋 ${i + 1} 이름`, onInput: e => { tuple[0] = e.target.value; this.touch(); } }), this.h('input', { value: tuple[1], 'aria-label': `에셋 ${i + 1} 참조`, onInput: e => { tuple[1] = e.target.value; this.touch(); } }), this.h('input', { value: tuple[2], 'aria-label': `에셋 ${i + 1} 확장자`, onInput: e => { tuple[2] = e.target.value; this.touch(); } }), this.b('해제', () => this.deleteAssets([tuple]), 'small danger')), duplicate || !tuple[1] ? h('p', { class: 'error muted' }, duplicate ? '중복된 에셋 이름입니다.' : '에셋 참조가 없습니다.') : null));
    }
    refresh();
    if (!list.length) host.append(h('div', { class: 'empty' }, '아직 등록한 이미지 에셋이 없습니다.'));
    host.append(this.b('이미지 파일 등록', async () => {
      const file = await this.file('image/*'); if (!file) return;
      assert(file.size <= 20 * 1024 * 1024, '이미지는 20MiB 이하만 등록할 수 있습니다.');
      const target = this.s.sessionId, data = new Uint8Array(await file.arrayBuffer());
      const path = await this.api.saveAsset(data); assert(this.s.sessionId === target, '작업 대상이 바뀌어 참조를 추가하지 않았습니다.');
      const ext = file.name.split('.').pop().toLowerCase(); this.s.draft.additionalAssets.push([file.name.replace(/\.[^.]+$/, ''), path, ext]); this.touch(); this.renderEditor();
    }));
  }
  async editIcon(remove = false) {
    assert(!this.job, '요청 처리 중에는 봇 아이콘을 변경할 수 없습니다.');
    const session = this.s, draft = session.draft, revision = session.revision;
    const current = () => assert(this.s === session && session.draft === draft && session.revision === revision && !this.job, '작업 대상이나 원고가 변경되어 봇 아이콘을 반영하지 않았습니다. 다시 시도해 주세요.');
    let path = '';
    if (remove) {
      if (!draft.image || !await this.confirm('봇 아이콘을 해제할까요?', '현재 원고의 대표 이미지 참조를 제거합니다. 공유 파일과 추가 에셋은 유지하며, 본체에는 저장 후 반영됩니다.')) return;
    } else {
      const file = await this.file('image/*'); if (!file) return;
      current();
      assert(file.size > 0 && file.size <= 20 * 1024 * 1024, '봇 아이콘은 비어 있지 않은 20MiB 이하 이미지여야 합니다.');
      assert(!file.type || file.type.startsWith('image/'), '이미지 파일을 선택해 주세요.');
      const data = new Uint8Array(await file.arrayBuffer()); current();
      path = await this.api.saveAsset(data);
      assert(typeof path === 'string' && path.length > 0, '봇 아이콘 파일을 저장하지 못했습니다.');
    }
    current();
    session.draft = withCharacterIcon(draft, path);
    this.touch(); this.renderEditor();
  }
  async deleteAssets(entries) {
    if (!entries.length) return;
    const session = this.s, draft = session.draft, revision = session.revision;
    const names = entries.slice(0, 10).map(entry => entry[0]).join('\n');
    if (!await this.confirm(`에셋 ${entries.length}개를 삭제할까요?`, `${names}${entries.length > 10 ? '\n외 ' + (entries.length - 10) + '개' : ''}\n\n현재 에셋 목록의 참조만 제거합니다. 대표 이미지·감정 이미지·공유 파일은 유지됩니다. 본체에는 저장 후 반영됩니다.`)) return;
    assert(this.s === session && session.draft === draft && session.revision === revision, '원고가 변경되어 삭제하지 않았습니다. 다시 선택해 주세요.');
    session.draft = removeAdditionalAssets(draft, entries);
    this.touch(); this.renderEditor();
  }
  renderChat() {
    const h = this.h.bind(this), s = this.s;
    const panel = h("aside", { class: "conversation", "aria-label": "LLM 제작 대화" });
    panel.append(h("div", { class: "chathead row between" }, h("div", {}, h("span", { class: "eyebrow" }, "CO-WRITING"), h("h3", { style: "margin-top:6px" }, "함께 만드는 대화")), this.b("대화 비우기", async () => {
      if (await this.confirm("제작 대화를 비울까요?", "원고와 수정안은 유지됩니다. 대화 기록만 삭제됩니다.")) {
        this.s.thread = [];
        this.touch(false);
        this.render();
      }
    }, "ghost small")));
    const messages = h("div", { class: "messages", role: "log", "aria-label": "제작 대화 기록" });
    this.messagesEl = messages;
    if (!s.thread.length) messages.append(h("div", { class: "chatempty" }, h("span", { class: "eyebrow" }, "LET’S MAKE SOMETHING"), h("h3", { style: "margin-top:10px" }, "한 가지 아이디어부터 시작하세요."), h("p", {}, "“이 세계관에 어울리는 인물부터 같이 정해보자.”\n“이 설정의 모순을 찾아줘.”\n“지금 정한 내용을 설명과 로어북으로 제안해줘.”"), h("p", { style: "margin-top:14px" }, "대화와 수정안은 원고와 구분해 보관합니다.")));
    for (const message of s.thread) {
      const row = h("article", { class: "message " + message.role }, h("span", { class: "msglabel" }, message.role === "user" ? "나" : "작성 파트너", message.task && message.task !== "workshop" && TASKS[message.task] ? h("span", { class: "msgtask" }, TASKS[message.task].label) : null), h("div", { class: "bubble" + (message.error ? " error" : "") }, message.content));
      if (message.images?.length) {
        const gallery = h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
        for (const image of message.images) gallery.append(h("img", { src: image.data, alt: image.name, loading: "lazy", style: "width:140px;max-width:100%;height:110px;object-fit:contain" }));
        row.append(gallery, h("span", { class: "muted" }, "이 요청에 첨부한 이미지 · 이후 요청에는 자동 재전송하지 않습니다."), this.b("이미지 다시 첨부", () => {
          if (this.job || this.imageLoading) return;
          const combined = validateRequestImages([...requestImages(this.s, this.task), ...clone(message.images).map((image) => ({ ...image, id: uid() }))]);
          this.s.requestImages ??= {};
          this.s.requestImages[this.task] = combined;
          this.touch(false);
          this.render();
        }, "small"));
      }
      if (message.raw) row.append(h("details", {}, h("summary", {}, "응답 원문"), h("pre", { class: "diff" }, message.raw)));
      messages.append(row);
    }
    for (const candidate of s.candidates.filter((c) => !c.status)) {
      const stale = !this.candidateValid(candidate);
      const card = h(
        "article",
        { class: "candidate" },
        h("div", { class: "row between" }, h("strong", {}, "원고 수정안"), h("span", { class: "pill" }, stale ? "원고가 변경됨" : "검토 대기")),
        h("p", { class: "muted" }, candidate.label),
        this.diffView(candidate),
        h("div", { class: "row" }, this.b("원고에 적용", () => this.applyCandidate(candidate), "primary small", { disabled: stale, "data-action": "apply-candidate" }), this.b("폐기", () => {
          candidate.status = "discarded";
          this.touch(false);
          this.render();
        }, "small")),
        stale ? h("p", { class: "warn" }, "요청 이후 원고·프롬프트가 바뀌었습니다. 이 제안은 적용할 수 없습니다. 현재 원고로 다시 요청하세요.") : null
      );
      messages.append(card);
    }
    if (this.undoAvailable()) messages.append(h("div", { class: "undo-bar row between" }, h("span", { class: "muted" }, "적용함 · " + s.undo.label), this.b("적용 되돌리기", () => this.undoApplied(), "small", { "data-action": "undo-candidate", title: "방금 적용한 수정안을 적용 전 원고로 되돌립니다. 이후 원고를 편집하면 되돌릴 수 없습니다." })));
    this.jobEl = h("div", { class: "jobbar", role: "status", "aria-live": "polite" });
    this.requestInput = h("textarea", { "aria-label": "LLM에게 보낼 요청", placeholder: this.task === "workshop" ? "아이디어를 이야기하거나, 현재 원고에서 다듬을 부분을 물어보세요." : TASKS[this.task].label + " 작성·수정 요청을 적으세요.", value: s.requests[this.task] ?? "" });
    this.requestInput.addEventListener("paste", (event) => this.pasteRequestImages(event));
    this.requestInput.addEventListener("input", () => {
      s.requests[this.task] = this.requestInput.value;
      this.fitRequestInput();
      this.touch(false);
    });
    this.requestInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        if (!this.job) this.sendButton.click();
      }
    });
    const taskSelect = this.select(this.task, Object.entries(TASKS).map(([k, v]) => [k, v.label]), (v) => {
      this.task = v;
      this.render();
    }, "LLM 요청 종류");
    const model = this.select(this.settings.model, [["submodel", "보조 모델"], ["model", "메인 모델"]], async (v) => {
      this.settings.model = v;
      this.navigate();
      await this.store("settings", this.settings).catch((error) => this.toast(error.message, true));
    }, "LLM 모델");
    const mobile = this.doc.defaultView?.matchMedia("(max-width: 840px)").matches;
    const sendLabel = mobile ? this.job ? "대기 중" : "전송 ↑" : this.job ? [h("span", { class: "spinner", "aria-hidden": "true" }), "작업 중"] : this.task === "workshop" ? "함께 구상하기 ↗" : "수정안 요청 ↗";
    const send = this.b(sendLabel, () => this.sendRequest(), "primary fill", { disabled: !!this.job || !!this.imageLoading, "data-action": "send-request", title: "Ctrl + Enter 전송 · 생성 결과는 검토 후 원고에 적용됩니다." });
    this.sendButton = send;
    const scope = ["lorebook", "regex"].includes(this.task) && (s.draft[this.task === "lorebook" ? "globalLore" : "customscript"] ?? []).length ? this.check("현재 선택한 항목만 수정", this.scopeOnly, (v) => {
      this.scopeOnly = v;
    }) : null;
    const composition = this.select(s.preset.mode, [["direct", "직접 요청"], ["preset", "프리셋 요청"]], (v) => {
      s.preset.mode = v;
      this.presetChanged();
      if (v === "preset" && !s.preset.preset) {
        s.tab = "preset";
        this.view = "editor";
      }
      this.render();
    }, "요청 구성");
    const requestSettings = h("div", { class: "request-settings", "data-open": "false" });
    const toggleLabel = TASKS[this.task].label + " ▾";
    const settingsToggle = this.b(toggleLabel, () => {
      const open = requestSettings.dataset.open !== "true";
      requestSettings.dataset.open = String(open);
      settingsToggle.setAttribute("aria-expanded", String(open));
      settingsToggle.textContent = open ? "설정 닫기 ▴" : toggleLabel;
    }, "request-settings-toggle", { "aria-expanded": "false", title: "요청 설정 · 종류·모델·구성을 바꿉니다." });
    const scopeOn = this.scopeOnly && ["lorebook", "regex"].includes(this.task) && (s.draft[this.task === "lorebook" ? "globalLore" : "customscript"] ?? []).length;
    const modeStrip = h("div", { class: "mode-strip", role: "status", "data-task": this.task }, h("span", { class: "mode-pill" }, TASKS[this.task].label), h("span", { class: "mode-scope" }, TASK_SCOPE[this.task] + (scopeOn ? " 현재 선택한 항목만 수정합니다." : "")));
    requestSettings.append(settingsToggle, h("div", { class: "request-settings-body" }, h("div", { class: "request-options" }, taskSelect, model, composition), scope, this.b("프롬프트 편집", () => this.showPrompt(this.task), "small mobile-prompt")));
    panel.append(messages, h(
      "div",
      { class: "composer" },
      requestSettings,
      modeStrip,
      this.requestInput,
      this.requestImageComposer(),
      h("div", { class: "row composer-actions" }, send, this.b("프롬프트", () => this.showPrompt(this.task), "", { "data-action": "prompt" }), this.job ? this.b("대기 중단", () => this.cancelRequest(), "danger small", { "data-action": "cancel-request" }) : null),
      this.b("대화 비우기", () => panel.querySelector(".chathead button").click(), "ghost small mobile-clear-chat", { "aria-label": "대화 비우기" }),
      this.jobEl
    ));
    queueMicrotask(() => {
      this.fitRequestInput();
      messages.scrollTop = messages.scrollHeight;
    });
    return panel;
  }
  candidateValid(c) { return c.sessionId === this.s.sessionId && c.targetId === this.s.targetId && c.revision === this.s.revision && c.promptRevision === this.s.promptRevision; }
  diffView(candidate) {
    const h = this.h.bind(this);
    let rows, sections = [];
    try {
      let draft = candidate.before;
      const packets = candidatePackets(candidate);
      packets.forEach((packet, i) => { const part = proposalDiff(draft, packet).map((row) => ({ ...row, part: packets.length > 1 ? candidate.partLabels?.[i] ?? `구간 ${i + 1}` : null })); sections.push(part); draft = applyPacket(draft, packet); });
      rows = sections.flat();
    } catch (error) {
      return h("p", { class: "warn" }, "수정안을 해석할 수 없습니다: " + error.message);
    }
    const display = value => value === undefined ? '(없음)' : value === '' ? '(빈 문자열)' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const numbered = (value, start) => value === '' ? '(구간 삭제)' : value.split(/\r\n|\r|\n/).map((line, i) => `${start + i} | ${line}`).join('\n');
    const lines = (start, end) => start === end ? `${start}행` : `${start}–${end}행`;
    const mobile = this.doc.defaultView?.matchMedia?.('(max-width: 840px)').matches;
    // Text-only CBS check on the proposed text of each field; the host is never executed.
    const cbs = rows.map((row) => typeof row.after === 'string' ? cbsIssues(row.after) : []);
    const cbsCount = cbs.reduce((n, list) => n + list.length, 0);
    return h('details', mobile ? { open: '' } : {}, h('summary', {}, `변경 내용 ${rows.length}개 구간·필드 확인` + (cbsCount ? ` · CBS 경고 ${cbsCount}건` : '')),
      cbsCount ? h('p', { class: 'warn cbs-summary' }, `CBS 검사 경고 ${cbsCount}건이 있습니다. 적용하면 리스 화면에서 조건 분기가 깨질 수 있으니 아래 구간별 안내를 확인하고, 필요하면 "{{else}}를 {{:else}}로 바꿔 줘"처럼 부분편집을 다시 요청하세요.`) : null,
      h('p', { class: 'muted' }, '부분편집의 줄 번호는 검토용입니다. 실제 적용은 요청 당시 원문과 정확히 일치하는 구간을 사용합니다. 코드 실행 결과를 검증한 것은 아닙니다.'),
      rows.map((row, i) => h('section', { class: 'card stack', style: 'margin:12px 0' }, row.part ? h('span', { class: 'pill' }, row.part) : null, h('strong', {}, row.label),
        cbs[i].length ? h('p', { class: 'warn cbs-warn' }, 'CBS 검사: ' + cbs[i].join(' ')) : null,
        h('span', { class: 'muted' }, row.mode === 'patch' ? `부분편집 · 기존 ${lines(row.startLine, row.endLine)} → ${row.after === '' ? '삭제' : '수정 ' + lines(row.afterStartLine, row.afterEndLine)}` : row.mode === 'add' ? '추가' : row.mode === 'remove' ? '삭제' : typeof row.after === 'string' ? '전체 문자열 교체' : '설정값 변경'),
        h('div', { class: 'diff' }, h('pre', { class: 'before' }, row.mode === 'patch' ? numbered(row.before, row.startLine) : display(row.before)), h('pre', { class: 'after' }, row.mode === 'patch' ? numbered(row.after, row.afterStartLine) : display(row.after))))));
  }
  async applyCandidate(candidate) {
    assert(this.candidateValid(candidate), "현재 원고와 다른 시점의 수정안입니다. 다시 요청하세요.");
    const loreBefore = loreSelection(this.s);
    let next = this.s.draft, lore = loreBefore;
    for (const packet of candidatePackets(candidate)) {
      const session = { ...this.s, draft: next, loreIncluded: lore };
      validateLoreSelection(packet, session);
      const applied = applyPacket(next, packet);
      lore = loreSelectionAfterPacket(session, packet);
      next = applied;
    }
    assert(this.candidateValid(candidate), "원고가 바뀌었습니다.");
    this.s.loreIncluded = lore;
    this.s.draft = next;
    candidate.status = "applied";
    this.touch();
    // One-step undo, valid only until the draft changes again.
    this.s.undo = { candidateId: candidate.id, sessionId: this.s.sessionId, revision: this.s.revision, restoreRevision: candidate.revision, before: candidate.before, loreIncluded: loreBefore, label: candidate.label };
    this.render();
    this.toast("수정안을 원고에 적용했습니다. 실제 캐릭터 저장은 별도입니다.");
  }
  undoAvailable() {
    const undo = this.s.undo;
    return !!undo && undo.sessionId === this.s.sessionId && undo.revision === this.s.revision && !this.job;
  }
  undoApplied() {
    assert(this.undoAvailable(), "적용 이후 원고가 바뀌어 되돌릴 수 없습니다.");
    const undo = this.s.undo, candidate = this.s.candidates.find((c) => c.id === undo.candidateId);
    this.s.draft = clone(undo.before);
    this.s.loreIncluded = loreSelection({ draft: this.s.draft, loreIncluded: undo.loreIncluded });
    this.s.revision = undo.restoreRevision;
    if (candidate) delete candidate.status;
    delete this.s.undo;
    this.touch(false);
    this.render();
    this.toast("수정안 적용을 되돌렸습니다. 수정안은 다시 검토 대기 상태입니다.");
  }
  requestWithScope(task) {
    const s = this.s, request = (s.requests[task] ?? "").trim() || (requestImages(s, task).length ? "첨부한 화면을 확인하고 현재 요청 작업에 맞게 분석해 주세요." : "");
    const scope = this.scopeOnly && ["lorebook", "regex"].includes(task) && (s.draft[task === "lorebook" ? "globalLore" : "customscript"] ?? []).length ? (task === "lorebook" ? "l" : "r") + (s.selected[task] ?? 0) : null;
    if (task === "lorebook" && scope) assert(loreSelection(s)[s.selected[task] ?? 0], "현재 편집 항목이 요청에서 제외되어 있습니다. 로어북 탭에서 ‘이번 요청에 포함’을 체크하거나 ‘현재 선택한 항목만 수정’을 해제하세요.");
    return { request, scope, text: request + (scope ? "\n[허용 편집 범위] 기존 항목 " + scope + "만 수정·삭제할 수 있다. 새 항목 추가와 다른 항목 변경은 금지한다." : "") };
  }
  // override.session / override.text let a chunk step compose against the staged draft with the step instruction.
  previewRequest(task = this.task, forcePreset = false, override = {}) {
    const usePreset = forcePreset || this.s.preset.mode === "preset", session = override.session ?? this.s;
    const direct = composeMessages(usePreset ? { ...session, thread: [] } : session, task, override.text ?? this.requestWithScope(task).text, this.prompts[task] ?? defaultPrompt(task), chunkOptions(this.settings));
    const report = usePreset ? assemblePreset(session.preset, session, task, direct) : { messages: direct, trace: [], issues: [], notes: [], globals: {} };
    return { ...report, messages: withRequestImages(report.messages, override.images ?? requestImages(this.s, task)) };
  }
  async sendRequest() {
    assert(!this.imageLoading, "이미지를 읽는 중입니다. 완료 후 전송해 주세요.");
    assert(!this.job, "다른 LLM 요청이 진행 중입니다.");
    const task = this.task, s = this.s, { request, scope, text: requestText } = this.requestWithScope(task);
    assert(request, "LLM에게 전달할 요청을 적어 주세요.");
    const report = this.previewRequest(task);
    assert(!report.issues.length, "프리셋 조립 오류:\n" + report.issues.join("\n"));
    const messages = report.messages;
    inputSize(messages, this.settings.maxInputChars);
    const meta = { sessionId: s.sessionId, targetId: s.targetId, revision: s.revision, promptRevision: s.promptRevision };
    const before = clone(s.draft), job = { ...meta, id: uid(), start: Date.now(), label: TASKS[task].label + " · 응답 대기", cancelled: false };
    this.job = job;
    const images = requestImages(s, task);
    s.thread.push({ id: uid(), role: "user", content: request, task, ...images.length ? { images: clone(images) } : {} });
    s.requests[task] = "";
    if (s.requestImages) s.requestImages[task] = [];
    this.touch(false);
    this.render();
    // Chunked work: each part is applied to a staged copy; the user reviews and applies the whole chain once.
    const options = chunkOptions(this.settings), parts = [], replies = [], notes = [];
    let raw, staged = clone(before), stagedLore = loreSelection(s);
    const stagedSession = () => ({ ...s, draft: staged, loreIncluded: stagedLore });
    const guard = (message) => assert(!job.cancelled && this.job?.id === job.id && this.candidateValid(meta), message);
    const receive = async (text, draft) => {
      const parsed = parseResponse(text, task, draft, true);
      if (parsed.data === null) return parsed;
      return reviewPacket(parsed, draft, (item) => { assert(!job.cancelled, "요청을 취소했습니다."); return this.chooseTextRange(item); });
    };
    // One request; a truncated answer (chunking on) or a broken-JSON answer is retried once with a pointed instruction.
    const ask = async (stepMessages, stepText) => {
      raw = await callModel(this.api, stepMessages, this.settings.model, this.settings.timeout, job);
      guard("요청 이후 작업 대상·원고·프롬프트가 바뀌어 응답을 폐기했습니다.");
      try { return await receive(raw, staged); } catch (error) {
        let hint, purpose, note;
        if (error.truncated && options.chunking) { purpose = "응답이 중간에 끊겼습니다"; note = "응답이 끊겨 더 작은 구간으로 다시 요청했습니다."; hint = "[주의] 직전 응답이 중간에 끊겼다. 이번에는 훨씬 작은 자립 구간 하나만 data에 완성하고 나머지는 모두 plan으로 넘겨라."; }
        else if (error.syntax) { purpose = "응답의 JSON 문법이 깨졌습니다"; note = "응답의 JSON 문법이 깨져 한 번 다시 요청했습니다."; hint = `[주의] 직전 응답의 JSON 문법이 깨졌다(${error.detail}). 문자열 안의 큰따옴표는 \\", 줄바꿈은 \\n, 역슬래시는 \\\\로 이스케이프하고, 코드·긴 본문은 JSON 뒤의 <<<이름>>> 블록으로 보내라.`; }
        else if (error.blocks) { purpose = "응답의 블록 참조 형식이 잘못됐습니다"; note = "블록 참조 형식이 잘못돼 한 번 다시 요청했습니다."; hint = `[주의] 직전 응답의 블록 참조가 잘못됐다(${error.message}). 블록을 쓸 자리에는 반드시 {"block":"이름"} 객체를 넣고, 블록 이름만 쓰거나 "<<<이름>>>" 문자열로 쓰지 마라. 보낸 블록은 모두 JSON에서 참조해야 하며, JSON이 참조한 블록은 모두 보내야 한다.`; }
        else throw error;
        // The user decides whether to spend another request: show why it failed and what the retry adds.
        if (!await this.confirmRetry(purpose, error, hint)) { error.message += " (재요청하지 않았습니다)"; throw error; }
        guard("요청 이후 작업 대상·원고·프롬프트가 바뀌어 응답을 폐기했습니다.");
        notes.push(note);
        const retry = this.previewRequest(task, false, { session: stagedSession(), text: stepText + "\n\n" + hint, images: [] });
        assert(!retry.issues.length, "프리셋 조립 오류:\n" + retry.issues.join("\n"));
        inputSize(retry.messages, this.settings.maxInputChars);
        raw = await callModel(this.api, retry.messages, this.settings.model, this.settings.timeout, job);
        guard("요청 이후 작업 대상·원고·프롬프트가 바뀌어 응답을 폐기했습니다.");
        return receive(raw, staged);
      }
    };
    const absorb = (packet, label) => {
      guard("검토 중 원고가 변경되었습니다. 최신 원고로 다시 요청하세요.");
      if (packet.data === null) return;
      const session = stagedSession();
      validateLoreSelection(packet, session);
      if (scope) assert(packet.data.upsert.every((x) => x.ref === scope) && packet.data.remove.every((x) => x === scope), "선택한 항목 밖의 변경이 포함되어 제안을 거부했습니다.");
      if (task === "workshop" && packet.data.reply) replies.push(packet.data.reply);
      if (!proposalDiff(staged, packet).length) return;
      const { plan, ...stored } = packet;
      parts.push({ packet: stored, label });
      stagedLore = loreSelectionAfterPacket(session, packet);
      staged = applyPacket(staged, packet);
    };
    const finish = (partial) => {
      const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      const summary = replies.length ? replies.join("\n\n") : parts.length ? TASKS[task].label + " 수정안을 작성했습니다. 아래에서 변경 내용을 검토하세요." : "원고에 적용할 변경 사항이 없습니다.";
      const chain = parts.length > 1 || partial ? `\n\n${partial ? "일부만 완성했습니다 · " : ""}${parts.length}개 구간${partial ? " 보관" : "으로 나눠 작성"}` : "";
      s.thread.push({ id: uid(), role: "assistant", task, content: summary + chain + (notes.length ? "\n\n" + notes.join("\n") : "") });
      if (parts.length) s.candidates.push({ ...meta, id: uid(), label: TASKS[task].label + " · " + time + (parts.length > 1 || partial ? ` · ${parts.length}구간${partial ? " (일부)" : ""}` : ""), before, ...parts.length === 1 && !partial ? { packet: parts[0].packet } : { packets: parts.map((p) => p.packet), partLabels: parts.map((p) => p.label) } });
      this.touch(false);
    };
    try {
      let packet = await ask(messages, requestText);
      let remaining = packet.plan ?? [];
      absorb(packet, "구간 1");
      if (remaining.length && !options.chunking) { notes.push(`모델이 ${remaining.length}개 구간을 더 제안했습니다. 설정에서 '긴 응답 나눠 받기'를 켜면 자동으로 이어 받습니다.`); remaining = []; }
      while (remaining.length) {
        if (parts.length >= options.chunkMax) { notes.push(`최대 구간 수(${options.chunkMax})에 도달해 남은 ${remaining.length}개 구간은 요청하지 않았습니다. 적용 후 이어서 요청하세요.`); break; }
        const next = remaining[0], index = parts.length + 1, total = Math.min(parts.length + remaining.length, options.chunkMax);
        job.label = `${TASKS[task].label} · 구간 ${index}/${total}`; this.jobStatus();
        assert(!job.cancelled, "요청을 취소했습니다.");
        const stepText = `${requestText}\n\n[분할 작업 ${index}/${total}] 이번 구간: ${next.title}\n${next.instruction}\n이전 구간의 결과는 이미 현재안에 반영되어 있다. 이번 구간만 작성하고, 아직 남은 구간이 있으면 plan에 남은 것만 다시 적어라(이번 구간은 제외). 남은 구간이 없으면 plan을 생략하라.`;
        const step = this.previewRequest(task, false, { session: stagedSession(), text: stepText, images: [] });
        assert(!step.issues.length, "프리셋 조립 오류:\n" + step.issues.join("\n"));
        inputSize(step.messages, this.settings.maxInputChars);
        packet = await ask(step.messages, stepText);
        const planned = packet.plan ?? remaining.slice(1);
        absorb(packet, `구간 ${index} · ${next.title}`);
        remaining = packet.data === null && !packet.plan ? [] : planned;
      }
      finish(false);
    } catch (error) {
      if (this.s.sessionId === s.sessionId) {
        if (parts.length) { notes.push(error.message); finish(true); }
        else { s.thread.push({ id: uid(), role: "assistant", task, content: error.message, error: true, ...raw ? { raw } : {} }); this.touch(false); }
      }
    } finally {
      if (this.job?.id === job.id) this.job = null;
      this.render();
    }
  }
  // Asks before an automatic re-request. Resolves true to retry, false to stop with the original error.
  async confirmRetry(purpose, error, hint) {
    const h = this.h.bind(this);
    return this.dialog("LLM에 다시 요청할까요?", (body) => {
      body.append(
        h("p", { class: "warn" }, `${purpose}. 이대로 두면 이번 응답은 폐기됩니다.`),
        h("h4", {}, "실패 원인"), h("pre", { class: "diff", style: "white-space:pre-wrap;max-height:200px;overflow:auto" }, error.message),
        h("h4", {}, "재요청 목적"), h("p", {}, "같은 요청에 아래 지시를 덧붙여 한 번 더 보냅니다. 현재안과 참고자료를 다시 보내므로 입력 토큰이 한 번 더 들고, 재요청은 이 자리에서 한 번만 합니다."),
        h("pre", { class: "diff", style: "white-space:pre-wrap;max-height:160px;overflow:auto" }, hint),
        h("p", { class: "muted" }, "중단하면 실패 원인이 대화에 남고 원고는 바뀌지 않습니다. 요청을 나누거나 부분편집으로 직접 다시 요청할 수 있습니다.")
      );
    }, [{ label: "중단", value: false }, { label: "다시 요청", value: true, kind: "primary" }]).then((value) => value === true);
  }
  async chooseTextRange({ source, edit, label, candidates }) {
    const h = this.h.bind(this);
    return this.dialog('수정 구간 확인 · ' + label, (body) => {
      let selected = null;
      const actual = h('pre', { class: 'diff', style: 'white-space:pre-wrap;max-height:220px;overflow:auto' }, '후보를 선택하거나 아래 원문에서 구간을 직접 선택하세요.');
      const replacement = h('textarea', { class: 'code', style: 'width:100%;min-height:120px', 'aria-label': '교체할 내용', value: edit.after });
      const preview = h('pre', { class: 'diff', style: 'white-space:pre-wrap;max-height:240px;overflow:auto' });
      const accept = this.b('선택 구간으로 수정안 준비', () => {
        if (selected) this.activeModal.close({ ...selected, after: replacement.value });
      }, 'primary', { disabled: true });
      const refresh = () => {
        preview.textContent = selected ? source.slice(0, selected.start) + replacement.value + source.slice(selected.end) : '';
      };
      const select = (range) => {
        selected = range;
        actual.textContent = source.slice(range.start, range.end);
        accept.disabled = false;
        refresh();
      };
      replacement.addEventListener('input', refresh);
      body.append(h('p', { class: 'warn' }, '원문을 확정할 수 없어 자동 적용하지 않았습니다. 실제 구간과 적용 후 내용을 비교하세요. 여기서는 수정안만 준비하며, 최종 반영은 검토 화면에서 합니다.'), h('h4', {}, 'LLM이 지목한 원문'), h('pre', { class: 'diff', style: 'white-space:pre-wrap;max-height:180px;overflow:auto' }, edit.before));
      for (const range of candidates) {
        const line = source.slice(0, range.start).split(/\r\n|\r|\n/).length;
        body.append(h('div', { class: 'card stack' }, this.b(range.kind + ' · ' + line + '행 · 이 구간 선택', () => select(range), 'small'), h('pre', { style: 'white-space:pre-wrap;max-height:160px;overflow:auto' }, source.slice(range.start, range.end))));
      }
      if (!candidates.length) body.append(h('p', { class: 'muted' }, '추천 후보가 없습니다. 원문에서 직접 구간을 선택하거나 이 수정을 건너뛰세요.'));
      const original = h('textarea', { readonly: true, value: source, style: 'width:100%;min-height:200px', 'aria-label': '실제 원문에서 교체 구간 선택' });
      body.append(h('details', {}, h('summary', {}, '원문에서 직접 선택'), original, this.b('선택한 원문 구간 사용', () => {
        if (original.selectionEnd > original.selectionStart) select({ start: original.selectionStart, end: original.selectionEnd });
      }, 'small')), h('h4', {}, '선택한 실제 원문'), actual, h('h4', {}, '교체할 내용 · 직접 수정 가능'), replacement, h('h4', {}, '적용 후 전체 내용'), preview, accept);
    }, [{ label: '이 수정 건너뛰기', value: null }]);
  }
  async showPrompt(task) {
    const h = this.h.bind(this), draft = this.s.promptDrafts[task] ??= clone(this.prompts[task] ?? defaultPrompt(task));
    await this.dialog(TASKS[task].label + ' · 프롬프트', body => {
      const saved = h('p', { class: 'muted' }, '저장한 템플릿이 다음 요청에 사용됩니다. 아래 편집 중인 내용은 저장 전까지 전송되지 않습니다.');
      const actual = h('pre', { class: 'diff' });
      const preview = () => { try { const report=this.previewRequest(task); actual.textContent=(report.issues.length?'전송할 수 없는 항목:\n'+report.issues.join('\n')+'\n\n':'')+JSON.stringify(report.messages, null, 2); } catch (e) { actual.textContent = e.message; } };
      const system = this.field('시스템 프롬프트 전체', draft.system, v => { draft.system = v; this.touch(false); }, { class: 'code', style: 'min-height:220px' });
      const user = this.field('사용자 프롬프트 템플릿', draft.user, v => { draft.user = v; this.touch(false); }, { class: 'code', style: 'min-height:230px' });
      body.append(saved, system, user, h('details',{},h('summary',{},'JSON 응답 형식과 예시'),h('pre',{class:'diff'},formatFor(task, this.s))), h('div', { class: 'row' }, this.b('프롬프트 저장', async () => {
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
    const result = await this.dialog("작업 설정", (body) => {
      body.append(this.h("p", { class: "muted" }, "30만 입력 토큰 규모용: 기본 3,000,000자, 전체 32MiB까지 전송합니다. 글자 수는 토큰 수가 아닙니다. 사용하는 모델·API가 입력 300,000토큰과 응답 여유를 지원해야 합니다. 본체 컨텍스트 설정은 자동 변경하지 않습니다."));
      body.append(this.h("label", { class: "field" }, this.h("span", {}, "화면 테마"), this.select(next.theme, [["system", "시스템 설정 따르기"], ["light", "라이트 모드"], ["dark", "다크 모드"]], (v) => next.theme = v, "화면 테마")), this.field("LLM 대기 제한 · 초 (10~3,600)", next.timeout, (v) => next.timeout = Number(v), { tag: "input", type: "number", min: 10, max: 3600 }), this.field("전체 전송 문자 한도 (1,000~10,000,000)", next.maxInputChars, (v) => next.maxInputChars = Number(v), { tag: "input", type: "number", min: 1e3, max: MAX_INPUT_CHARS }), this.h("h3", {}, "분할 작업"), this.check("긴 응답 나눠 받기 · 결과가 예산을 넘으면 모델이 구간 계획을 세우고 봇빌더가 자동으로 이어 요청합니다", next.chunking !== false, (v) => next.chunking = v), this.field("응답당 출력 예산 · 토큰 (사고 토큰 제외, 1,000~30,000)", next.chunkTokens, (v) => next.chunkTokens = Number(v), { tag: "input", type: "number", min: CHUNK_MIN_TOKENS, max: CHUNK_MAX_TOKENS }), this.field("최대 구간 수 (2~12)", next.chunkMax, (v) => next.chunkMax = Number(v), { tag: "input", type: "number", min: 2, max: CHUNK_HARD_MAX }), this.h("p", { class: "muted" }, "구간마다 현재안을 다시 보내므로 입력 토큰은 구간 수에 비례해 늘어납니다. 구간 결과는 임시 원고에 쌓이고, 검토와 적용은 마지막에 한 번만 합니다. 중간에 취소하면 그때까지 완성된 구간만 수정안으로 남깁니다."), this.h("p", { class: "muted" }, "자동 저장 간격은 3분입니다. 자동 저장과 수동 임시 저장은 각각 최근 1개를 보관합니다. 대기 중단은 실제 네트워크 취소를 보장하지 않습니다. 플러그인은 자동 재시도하지 않으며, 호스트 자체의 재시도 정책은 호스트 설정을 따릅니다."));
    }, [{ label: "취소", value: false }, { label: "저장", value: true, kind: "primary" }]);
    if (result) {
      assert(Number.isInteger(next.timeout) && next.timeout >= 10 && next.timeout <= 3600 && Number.isInteger(next.maxInputChars) && next.maxInputChars >= 1e3 && next.maxInputChars <= MAX_INPUT_CHARS, "설정 범위를 확인하세요.");
      assert(Number.isInteger(next.chunkTokens) && next.chunkTokens >= CHUNK_MIN_TOKENS && next.chunkTokens <= CHUNK_MAX_TOKENS && Number.isInteger(next.chunkMax) && next.chunkMax >= 2 && next.chunkMax <= CHUNK_HARD_MAX, "분할 작업 설정 범위를 확인하세요.");
      next.chunking = next.chunking !== false;
      next.inputLimitVersion = INPUT_LIMIT_VERSION;
      await this.store("settings", next);
      this.settings = next;
      this.applyTheme();
      this.render();
      this.toast("설정을 저장했습니다.");
    }
  }
  async guardReplace() {
    assert(!this.ioBusy, '파일·캐릭터 작업이 진행 중입니다.');
    if (this.dirty() || this.s.thread.length || this.s.candidates.some(c => !c.status)) return this.confirm('지금 작업을 바꿀까요?', '원고·제작 대화·수정안을 바꿉니다. 남길 내용이 있으면 먼저 임시 저장하세요.');
    return true;
  }
  async replaceSession(session) {
    const preset = session.preset ? validatePresetState(session.preset) : clone(this.savedPreset ?? newPresetState());
    this.job?.stop?.("작업이 바뀌어 이전 요청의 대기를 중단했습니다.");
    this.s = session;
    this.s.preset = preset;
    if (session.requestSettings) {
      // A saved session restores only its request context (model choice, task, scope).
      // Timeout, input limit, theme and chunking are global settings and stay as the user last saved them.
      const p = session.requestSettings;
      if (["model", "submodel"].includes(p.model)) this.settings.model = p.model;
      if (TASKS[p.task]) this.task = p.task;
      this.scopeOnly = !!p.scopeOnly;
    } else {
      this.task = "workshop";
      this.scopeOnly = false;
    }
    this.started = true;
    this.serial++;
    this.view = "editor";
    this.render();
  }
  async newWork() { if (await this.guardReplace()) await this.replaceSession(newSession()); }
  async loadCharacters() {
    const db = await this.api.getDatabase(['characters']); assert(db?.characters, '캐릭터 접근 권한이 필요합니다.');
    const chars = listCharacters(db).filter(c => c && (!c.type || c.type === 'character'));
    let selected = null;
    await this.dialog('캐릭터 불러오기', body => {
      const results = this.h('div', { class: 'stack' });
      const draw = query => results.replaceChildren(...chars.filter(c => c.name?.toLowerCase().includes(query.toLowerCase())).map(c => this.b(c.name || '(이름 없음)', async () => { selected = c.chaId; this.activeModal.close(true); })));
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
      for (const key of [...AUTOSAVE_KEYS, 'manual']) {
        const v = this.slots[key];
        if (!v && key !== 'autosave' && key !== 'manual') continue;
        body.append(this.h('div', { class: 'card stack' }, this.h('h3', {}, SLOT_NAMES[key]), this.h('p', { class: 'muted' }, v?.error ?? (v ? `${v.name} · ${new Date(v.savedAt).toLocaleString('ko-KR')}` : '아직 저장본이 없습니다.')), this.b('이 저장본 불러오기', () => { choice = key; this.activeModal.close(true); }, '', { disabled: !v || !!v.error })));
      }
      body.append(this.h('p', { class: 'muted' }, '자동 저장은 3분 간격으로 최근 3개, 수동 임시 저장은 최근 1개를 보관합니다. 복원하면 원고·대화·미적용 제안·프롬프트 편집 초안을 불러옵니다. 캐릭터 본체나 저장된 프롬프트 설정에는 자동으로 반영하지 않습니다.'));
    }, [{ label: initial ? '저장본 유지하고 새로 시작' : '닫기', value: false }]);
    if (!choice) return;
    if (!initial && !await this.guardReplace()) return;
    await this.replaceSession(restoreSnapshot(this.slots[choice]));
    this.toast('저장본을 복원했습니다. 진행 중이던 LLM 요청은 다시 전송하지 않습니다.');
  }
  async saveHost() {
    assert(!this.ioBusy, "저장 작업이 진행 중입니다.");
    assert(this.started, "먼저 새 작업을 시작하거나 원고를 작성하세요.");
    assert(this.s.draft.name?.trim(), "캐릭터 이름을 입력하세요.");
    const fields = this.s.base ? FIELDS.filter((f) => !equal(this.s.base[f], this.s.draft[f])) : FIELDS;
    if (this.s.targetId && !fields.length) return this.toast("저장할 원고 변경이 없습니다.");
    if (!await this.confirm(this.s.targetId ? "캐릭터에 저장할까요?" : "새 캐릭터로 등록할까요?", "변경 영역: " + fields.map((f) => fieldNames[f] ?? f).join(", ") + "\n제작 대화와 미적용 수정안은 캐릭터에 저장되지 않습니다.")) return;
    const captured = clone(this.s), revision = this.s.revision;
    this.ioBusy = true;
    try {
      let saved;
      if (captured.targetId) {
        let result = await saveExisting(this.api, captured);
        if (result.conflicts.length) {
          const choices = await this.reviewSaveConflicts(captured, result);
          if (!choices) return;
          assert(this.s.sessionId === captured.sessionId && this.s.revision === revision, "검토 중 봇빌더 원고가 바뀌었습니다. 다시 저장해 주세요.");
          result = await saveExisting(this.api, captured, { current: result.current, choices });
        }
        saved = result.saved;
      } else saved = await saveNew(this.api, captured);
      if (this.s.sessionId === captured.sessionId) {
        this.s.targetId = saved.chaId;
        this.s.base = editable(saved);
        this.s.source = clone(saved);
        delete this.s.source.chats;
        delete this.s.source.chatFolders;
        delete this.s.source.chatPage;
        if (this.s.revision === revision) {
          this.s.loreIncluded = reconcileLoreSelection(this.s, saved.globalLore ?? []);
          this.s.draft = { ...this.s.draft, ...editable(saved), chaId: saved.chaId };
        }
        this.touch(false);
        this.render();
      }
      this.toast("캐릭터를 저장했습니다. 기존 대화와 편집하지 않은 필드는 유지했습니다.");
    } finally {
      this.ioBusy = false;
    }
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
    assert(!this.ioBusy, "다른 파일·저장 작업이 진행 중입니다.");
    this.ioBusy = true;
    const char = clone(this.s.draft), meta = clone(this.s.cardMeta);
    try {
      const notices = [];
      const data = await exportCharx(this.api, char, meta, notices), url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
      const a = this.h("a", { href: url, download: (char.name || "character").replace(/[<>:"/\\|?*]/g, "_") + ".charx" });
      this.doc.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 6e4);
      if (notices.length) {
        await this.dialog("CHARX 다운로드 · 에셋 참조 안내", (body) => body.append(this.h(
          "p",
          { style: "white-space:pre-wrap;line-height:1.8" },
          `리스 본체와 같은 방식으로 ${notices.length}개 에셋의 URI를 그대로 보존했습니다. 이 항목의 파일을 새로 포함하거나 외부에서 다운로드하지 않았습니다.

` + notices.map((n) => `${n.name} (${n.type}): ${n.kind === "unresolved-embedded" ? "원본 내장 파일을 확보하지 못함 · 이미지 표시 보장 불가" : "원래 참조 유지"}`).join("\n")
        )));
      }
      this.toast("charx 다운로드를 요청했습니다.");
    } finally {
      this.ioBusy = false;
    }
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
