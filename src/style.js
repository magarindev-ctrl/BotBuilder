export const CSS = `
:root {
  color-scheme: light;
  --bg: #f4f2ed; --paper: #fffefa; --line: #dddcd3;
  --ink: #243431; --muted: #5c6a65;
  --accent: #23685b; --accent-bg: #e6f0eb; --warm: #a05a39; --error: #a53232;
  --hover: #eaece5; --hover-line: #b9c6be; --focus: #93beb0;
  --primary-bg: #23685b; --primary-ink: #fff; --primary-hover: #1c554a;
  --selected: #e1e9df; --subtle: #657169; --brand-line: #9eb5a9;
  --hero-bg: linear-gradient(135deg, #e7eee4, #f7f4e9); --hero-line: #cdd9cf;
  --hero-ink: #53665b; --step-line: #cfdbd0; --chat-bg: #fcfcf8; --bubble-bg: #e9eee5;
  --candidate-bg: #fffdf4; --candidate-line: #dac99b; --candidate-tag: #efe7c8; --candidate-ink: #795e25;
  --diff-bg: #f8f8f2; --before-bg: #f8eeee; --before-ink: #895d54; --after-bg: #edf5eb; --after-ink: #3d644e;
  --warn-bg: #fbf0da; --warn-ink: #985324; --toast-bg: #253e34; --overlay: #18251f66;
  font-family: Inter, "Pretendard", "Malgun Gothic", system-ui, sans-serif;
  font-size: 14px;
}
:root[data-theme=dark] {
  color-scheme: dark;
  --bg: #171717; --paper: #222; --line: #414141;
  --ink: #ededed; --muted: #b5b5b5;
  --accent: #d5d5d5; --accent-bg: #353535; --warm: #c4c4c4; --error: #f4aaa3;
  --hover: #333; --hover-line: #777; --focus: #aaa;
  --primary-bg: #dedede; --primary-ink: #181818; --primary-hover: #f3f3f3;
  --selected: #383838; --subtle: #aaa; --brand-line: #757575;
  --hero-bg: linear-gradient(135deg, #252525, #2b2b2b); --hero-line: #4b4b4b;
  --hero-ink: #c4c4c4; --step-line: #626262; --chat-bg: #1c1c1c; --bubble-bg: #333;
  --candidate-bg: #2b2b2b; --candidate-line: #a3a3a3; --candidate-tag: #e6e6e6; --candidate-ink: #181818;
  --diff-bg: #1b1b1b; --before-bg: #342b2b; --before-ink: #e6bdb9; --after-bg: #303030; --after-ink: #e0e0e0;
  --warn-bg: #352f23; --warn-ink: #eed09b; --toast-bg: #414141; --overlay: #0009;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { width: 100%; height: 100%; min-height: 0; margin: 0; overflow: hidden; }
body { background: var(--bg); color: var(--ink); }
#story-workshop {
  position: fixed; inset: 0; isolation: isolate;
  display: grid; grid-template-rows: auto auto minmax(0, 1fr);
  min-width: 0; min-height: 0; overflow: hidden;
  background: var(--bg); color: var(--ink);
}
button, input, textarea, select { font: inherit; }
button {
  cursor: pointer; border: 1px solid var(--line); color: var(--ink); background: var(--paper);
  border-radius: 9px; padding: 8px 12px; min-height: 36px; max-width: 100%;
}
button:hover { background: var(--hover); border-color: var(--hover-line); }
button:disabled { opacity: .48; cursor: not-allowed; }
button.primary { background: var(--primary-bg); color: var(--primary-ink); border-color: var(--primary-bg); font-weight: 650; }
button.primary:hover { background: var(--primary-hover); }
button.ghost { background: transparent; border-color: transparent; }
button.small { padding: 5px 9px; min-height: 30px; font-size: 12px; }
button.danger { color: var(--error); }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
input, textarea, select {
  border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink);
  padding: 9px 11px; min-width: 0; max-width: 100%;
}
textarea { resize: vertical; line-height: 1.7; min-height: 110px; width: 100%; }
textarea::placeholder, input::placeholder { color: var(--muted); opacity: 1; }
input:not([type=checkbox]), select { width: 100%; }
input[type=checkbox] { accent-color: var(--accent); }
textarea.code, .code, pre { font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; tab-size: 2; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; margin: 0; min-width: 0; }
h1, h2, h3, p { margin: 0; overflow-wrap: anywhere; }
h1 { font-size: 18px; letter-spacing: -.7px; }
h2 { font-size: 21px; font-weight: 650; letter-spacing: -.7px; }
h3 { font-size: 14px; font-weight: 650; }
.muted { color: var(--muted); font-size: 12px; line-height: 1.65; }
.eyebrow { font-size: 11px; letter-spacing: 2px; color: var(--warm); font-weight: 700; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.between { justify-content: space-between; }
.stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.fill { flex: 1; min-width: 0; }
.pill { font-size: 11px; border-radius: 20px; background: var(--accent-bg); color: var(--accent); padding: 4px 8px; white-space: nowrap; }
.warn { color: var(--warn-ink); background: var(--warn-bg); border-radius: 8px; padding: 10px; line-height: 1.6; font-size: 12px; }
.error { color: var(--error); }
.topbar {
  min-height: 77px; padding: 14px 24px; display: flex; flex-wrap: wrap;
  align-items: center; justify-content: space-between; gap: 12px 16px;
  border-bottom: 1px solid var(--line); background: var(--paper); min-width: 0;
}
.brand { display: flex; gap: 12px; align-items: center; flex-shrink: 0; }
.brandmark {
  display: grid; place-items: center; width: 39px; height: 39px; flex-shrink: 0;
  border: 1px solid var(--brand-line); border-radius: 50% 50% 10px 10px;
  color: var(--accent); font-size: 17px; font-weight: 700; font-family: Georgia, serif;
}
.document-title { flex: 1 1 180px; flex-wrap: nowrap; overflow: hidden; }
.document-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-actions { flex: 0 1 auto; }
.toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0;
  padding: 10px 24px; border-bottom: 1px solid var(--line); background: var(--paper);
}
.toolbar-files, .toolbar-saves { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.toolbar-saves { margin-left: auto; }
.workspace {
  display: grid; grid-template-columns: 172px minmax(0, 1fr) minmax(320px, 420px);
  min-width: 0; min-height: 0; overflow: hidden; background: var(--bg);
}
.sidebar { padding: 25px 12px; border-right: 1px solid var(--line); overflow: auto; min-width: 0; min-height: 0; }
.sidebar .eyebrow { padding: 0 12px 14px; display: block; }
.navitem { display: flex; gap: 10px; text-align: left; width: 100%; border: 0; background: transparent; padding: 13px 10px; margin: 3px 0; border-radius: 8px; align-items: center; }
.navitem[aria-current=page] { color: var(--accent); background: var(--selected); font-weight: 650; }
.navnum { font-family: Georgia, serif; color: var(--subtle); font-size: 12px; flex-shrink: 0; }
.navlabel { min-width: 0; }
.navmeta { margin-left: auto; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.navcount { color: var(--subtle); font-size: 11px; }
.navcount:empty { display: none; }
.navdot { display: none; width: 7px; height: 7px; border-radius: 50%; background: var(--warm); }
.navitem[data-changed=true] .navdot { display: inline-block; }
.sidefoot { margin: 26px 10px; padding-top: 17px; border-top: 1px solid var(--line); }
.editor { overflow: auto; min-width: 0; min-height: 0; padding: 28px 32px 60px; background: var(--bg); overscroll-behavior: contain; }
.sectionhead { margin-bottom: 24px; }
.sectionhead p { margin-top: 8px; }
.field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.field > span:first-child { font-size: 12px; font-weight: 650; }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 18px; min-width: 0; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
.ruled { border: 0; border-top: 1px solid var(--line); margin: 8px 0; }
.hero { padding: 25px; border: 1px solid var(--hero-line); border-radius: 14px; background: var(--hero-bg); min-width: 0; }
.hero h2 { font-family: Georgia, "Malgun Gothic", serif; font-weight: 500; font-size: 26px; line-height: 1.5; }
.hero p { max-width: 620px; margin-top: 13px; line-height: 1.8; font-size: 13px; color: var(--hero-ink); }
.steps { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
.step { border: 1px solid var(--step-line); border-radius: 20px; padding: 5px 10px; color: var(--hero-ink); font-size: 11px; }
.list-editor { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 16px; min-width: 0; }
.preset-block-list { max-height: 560px; overflow: auto; }
.itemlist { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.listitem { padding: 10px; text-align: left; overflow-wrap: anywhere; min-height: 42px; }
.listitem.active { border-color: var(--brand-line); background: var(--accent-bg); }
/* Lorebook rows must not inherit the mobile horizontal button strip. */
.itemlist.lore-request-list {
  display: flex; flex-direction: column; align-self: start;
  width: 100%; min-width: 0; min-height: 0; max-height: 560px;
  overflow-y: auto; overflow-x: hidden; gap: 8px;
  padding: 2px; scrollbar-gutter: stable; touch-action: pan-y;
}
.lore-request-item {
  display: flex; flex-direction: column; flex: 0 0 auto;
  width: 100%; min-width: 0; gap: 2px; padding: 6px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--paper);
}
.lore-request-item.is-selected { border-color: var(--brand-line); background: var(--accent-bg); }
.lore-request-list .listitem {
  display: block; width: 100%; min-width: 0; max-width: none;
  min-height: 44px; height: auto; padding: 10px; line-height: 1.5;
  white-space: normal; overflow-wrap: anywhere; word-break: break-word;
}
.lore-request-toggle.row {
  flex-wrap: nowrap; min-height: 44px; width: 100%; margin: 0;
  padding: 8px 10px; gap: 10px; cursor: pointer; line-height: 1.5;
  overflow-wrap: anywhere;
}
.lore-request-toggle input[type=checkbox] {
  flex: 0 0 20px; width: 20px; height: 20px; min-width: 20px; margin: 0;
}

.textarea-large { min-height: 330px; }
.conversation {
  display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden;
  border-left: 1px solid var(--line); background: var(--chat-bg);
}
.chathead { padding: 20px 20px 15px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.messages {
  flex: 1 1 0; min-height: 0; min-width: 0; overflow: auto; padding: 22px 20px;
  display: flex; flex-direction: column; gap: 18px; overscroll-behavior: contain;
}
.message { display: flex; flex-direction: column; gap: 7px; min-width: 0; flex-shrink: 0; }
.message.user { align-items: flex-end; }
.msglabel { font-size: 11px; letter-spacing: .3px; color: var(--subtle); display: inline-flex; align-items: center; gap: 6px; }
.msgtask { font-size: 10px; letter-spacing: 0; padding: 1px 7px; border-radius: 10px; background: var(--accent-bg); color: var(--accent); font-weight: 650; }
.mode-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; font-size: 12px; color: var(--muted); line-height: 1.5; }
.mode-pill { background: var(--accent-bg); color: var(--accent); font-weight: 650; padding: 3px 10px; border-radius: 20px; font-size: 12px; white-space: nowrap; }
.mode-strip[data-task=workshop] .mode-pill { background: var(--selected); color: var(--ink); }
.mode-scope { flex: 1 1 200px; min-width: 0; }
.bubble { font-size: 13px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.message.user .bubble { background: var(--bubble-bg); border-radius: 12px 12px 2px 12px; padding: 11px 14px; max-width: 95%; }
.message.assistant .bubble { padding: 0 3px; }
.chatempty { margin: auto 0; padding: 20px 8px; color: var(--muted); }
.chatempty h3 { color: var(--ink); font-size: 17px; font-family: Georgia, "Malgun Gothic", serif; font-weight: 500; margin-bottom: 12px; }
.chatempty p { font-size: 12px; line-height: 1.9; }
.composer {
  flex: 0 1 auto; min-height: 0; min-width: 0; overflow: auto;
  padding: 15px 18px 18px; background: var(--paper); border-top: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 9px; overscroll-behavior: contain;
}
.composer > * { flex-shrink: 0; }
.composer textarea { min-height: 80px; max-height: 180px; }
.composer select { font-size: 12px; padding: 7px; }
.request-options { display: grid; grid-template-columns: minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr); gap: 6px; }
.candidate { background: var(--candidate-bg); border: 1.5px solid var(--candidate-line); border-left-width: 5px; border-radius: 10px; padding: 13px; display: flex; flex-direction: column; gap: 10px; min-width: 0; flex-shrink: 0; }
.candidate .pill { background: var(--candidate-tag); color: var(--candidate-ink); }
.undo-bar { border: 1px dashed var(--candidate-line); border-radius: 10px; padding: 8px 12px; flex-shrink: 0; }
.diff { border: 1px solid var(--line); border-radius: 8px; padding: 10px; max-height: 360px; overflow: auto; background: var(--diff-bg); min-width: 0; }
.diff .before { color: var(--before-ink); background: var(--before-bg); padding: 8px; }
.diff .after { color: var(--after-ink); background: var(--after-bg); padding: 8px; margin-top: 6px; }
details { min-width: 0; }
details > summary { cursor: pointer; font-size: 12px; color: var(--accent); padding: 5px 0; }
details[open] > summary { margin-bottom: 9px; }
.jobbar { display: flex; align-items: center; gap: 8px; color: var(--accent); font-size: 12px; min-height: 24px; }
.spinner { display: inline-block; flex-shrink: 0; width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: middle; margin-right: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 1000; background: var(--toast-bg); color: #fff; padding: 12px 18px; border-radius: 10px; max-width: min(700px, 90vw); box-shadow: 0 4px 24px #0002; font-size: 13px; line-height: 1.6; pointer-events: none; display: flex; align-items: flex-start; gap: 12px; }
.toast-text { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.toast.bad { background: #843d35; pointer-events: auto; user-select: text; max-height: 60vh; overflow: auto; }
.toast-close { flex-shrink: 0; color: #fff; background: transparent; border-color: #fff8; }
.toast-close:hover { background: #fff2; border-color: #fff; }
.modal-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 100; display: grid; place-items: center; padding: 20px; }
.modal { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; width: min(860px, 100%); max-height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column; box-shadow: 0 18px 80px #0005; }
.modalhead { padding: 18px 22px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.modalbody { padding: 22px; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 16px; }
.modalbody > * { flex-shrink: 0; }
.modalfoot { padding: 14px 22px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.empty { padding: 30px 14px; border: 1px dashed var(--line); border-radius: 10px; text-align: center; color: var(--muted); font-size: 13px; line-height: 1.9; }
.mobile-switch { display: none; }
.status-text { font-size: 11px; line-height: 1.5; color: var(--muted); }
.nowrap { white-space: nowrap; }
.testresult { max-height: 400px; overflow: auto; }
.assetrow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 70px auto; gap: 8px; align-items: center; }

@media (min-width: 1550px) {
  .workspace { grid-template-columns: 190px minmax(0, 1fr) minmax(400px, 480px); }
  .editor { padding: 32px 50px; }
}
@media (max-width: 1100px) {
  .workspace { grid-template-columns: 132px minmax(0, 1fr) 320px; }
  .editor { padding: 22px 20px; }
  .sidebar { padding: 20px 7px; }
  .navitem { gap: 7px; padding: 12px 7px; font-size: 13px; }
  .list-editor { grid-template-columns: minmax(0, 1fr); }
  .itemlist { flex-direction: row; overflow-x: auto; }
  .preset-block-list { max-height: 140px; }
  .itemlist.lore-request-list { flex-direction: column; max-height: 42vh; max-height: min(42dvh, 420px); }
  .lore-request-list .listitem { min-width: 0; max-width: none; }
  .listitem { min-width: 120px; max-width: 180px; flex-shrink: 0; }
  .topbar { padding: 12px 16px; }
  .toolbar { padding: 8px 16px; }
  .status-text { max-width: 230px; }
}
@media (max-width: 840px) {
  .topbar { min-height: 72px; padding: 12px 16px; gap: 10px; }
  .brand { flex: 0 1 auto; }
  .document-title { flex: 1 1 130px; }
  .header-actions { margin-left: auto; }
  .toolbar { padding: 8px 12px; }
  .toolbar-files, .toolbar-saves { flex: 1 1 auto; }
  .toolbar-saves { margin-left: 0; }
  .workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .sidebar { display: flex; overflow-x: auto; padding: 6px; border-right: 0; border-bottom: 1px solid var(--line); scrollbar-width: none; }
  .sidebar::-webkit-scrollbar { display: none; }
  /* Fade the right edge while more tabs are hidden past it. */
  .sidebar[data-overflow=true] { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent); }
  .sidebar .eyebrow, .sidefoot, .navnum, .navcount { display: none; }
  .navmeta { margin-left: 4px; }
  .navitem { width: auto; flex-shrink: 0; white-space: nowrap; padding: 10px; margin: 0; }
  .editor { padding: 22px 16px; }
  .conversation { grid-row: 1 / -1; border-left: 0; }
  .mobile-switch { display: flex; gap: 4px; }
  .mobile-switch button[aria-pressed=true] { background: var(--accent-bg); border-color: var(--brand-line); }
  .workspace[data-view=editor] .conversation { display: none; }
  .workspace[data-view=chat] .editor, .workspace[data-view=chat] .sidebar { display: none; }
  .grid2 { grid-template-columns: minmax(0, 1fr); }
  .assetrow { grid-template-columns: minmax(0, 1fr) auto; }
  .assetrow input:nth-child(2) { grid-column: 1 / -1; }
  .modal-overlay { padding: 10px; }
  .modalbody { padding: 16px; }
  .hero { padding: 19px; }
  .hero h2 { font-size: 23px; }
  .toolbar button { font-size: 12px; min-height: 34px; }
  .chathead { padding: 15px 18px; }
  .brandmark { width: 34px; height: 34px; }
  .topbar h1 { font-size: 17px; }
}
@media (max-height: 650px) {
  .topbar { min-height: 60px; padding: 8px 14px; gap: 8px 12px; }
  .toolbar { padding: 6px 12px; gap: 6px; }
  .toolbar-files, .toolbar-saves { gap: 6px; }
  .chathead { padding: 10px 14px; }
  .composer { padding: 10px 12px; gap: 7px; }
  .composer textarea { min-height: 64px; max-height: 110px; }
  .composer > .muted:last-child { display: none; }
  .jobbar { min-height: 20px; }
}
.mobile-top, .request-settings-toggle, .mobile-prompt, .mobile-clear-chat { display: none; }
.request-settings-body { display: flex; flex-direction: column; gap: 8px; }
@media (max-width: 840px) {
  #story-workshop { inset: auto 0 auto; top: var(--workshop-vtop, 0px); height: var(--workshop-vheight, 100dvh); grid-template-rows: auto minmax(0, 1fr); }
  .topbar, .toolbar, .chathead { display: none; }
  .mobile-top { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 6px 10px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .mobile-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .mobile-top .document-name { font-size: 13px; }
  .mobile-status { font-size: 11px; line-height: 1.3; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mobile-top button { min-height: 40px; padding: 6px 9px; font-size: 12px; flex-shrink: 0; }
  .mobile-top button[aria-pressed=true] { background: var(--accent-bg); border-color: var(--brand-line); }
  .workspace { grid-row: 2; }
  .messages { padding: 14px 12px; gap: 14px; }
  .composer { display: grid; grid-template-columns: auto minmax(0,1fr) auto; grid-template-areas: 'previews previews previews' 'input input input' 'attach options send' 'clear clear clear' 'status status status'; gap: 6px; padding: 8px 10px max(8px, env(safe-area-inset-bottom)); flex: 0 0 auto; max-height: 48%; }
  .composer > textarea { grid-area: input; width: 100%; min-height: 52px; max-height: 122px; height: 52px; font-size: 16px; line-height: 22px; padding: 4px 9px; resize: none; }
  .mobile-prompt { display: block; }
  .request-settings { grid-area: options; min-width: 0; }
  .composer > .mode-strip { display: none; }
  .request-settings-toggle { display: block; width: 100%; min-height: 40px; padding: 6px; font-size: 12px; }
  .request-settings-body { display: none; }
  .request-settings[data-open=true] .request-settings-body { display: flex; position: fixed; z-index: 12; bottom: calc(100% - var(--workshop-vheight, 100dvh) - var(--workshop-vtop, 0px) + 150px); left: 10px; right: 10px; max-height: 40dvh; overflow: auto; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 12px; box-shadow: 0 5px 30px #0005; }
  .request-options { grid-template-columns: minmax(0,1fr); }
  .request-options select { min-height: 40px; font-size: 16px; }
  .request-images { display: contents; }
  .request-images > button { grid-area: attach; min-height: 40px; padding: 6px 10px; font-size: 12px; }
  .request-images > .muted { display: none; }
  .request-previews { grid-area: previews; flex-wrap: nowrap !important; overflow-x: auto; max-height: 120px; }
  .request-previews:empty { display: none !important; }
  .request-previews .card { width: 90px !important; flex-shrink: 0; padding: 4px; }
  .request-previews img { height: 48px !important; }
  .request-previews span { display: none; }
  .request-previews button { min-height: 32px; padding: 2px 6px; font-size: 11px; }
  .composer-actions { display: contents; }
  .composer-actions > button { display: none; }
  .composer-actions > [data-action=send-request] { display: block; grid-area: send; min-height: 40px; padding: 6px 14px; }
  .mobile-clear-chat { display: block; grid-area: clear; justify-self: end; min-height: 36px; padding: 4px 8px; font-size: 12px; }
  .composer > .muted { display: none; }
  .composer .jobbar { grid-area: status; min-height: 0; font-size: 11px; }
  #story-workshop[aria-busy=false] .composer .jobbar { display: none; }
  .toast { bottom: auto; top: calc(var(--workshop-vtop, 0px) + 58px); max-width: calc(100vw - 20px); }
  .toast.bad { max-height: 40vh; }
  .mobile-menu-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .mobile-menu-list button { min-height: 46px; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 2s; }
  * { scroll-behavior: auto !important; transition: none !important; }
}
`;
