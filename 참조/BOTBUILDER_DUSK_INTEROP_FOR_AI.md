# BotBuilder × Dusk Atelier — DA Interop integration spec (for AI agents)

Target: BotBuilder (`//@name risu_story_workshop`, display name 봇빌더), verified against v1.0.1 (dist build).
Goal: let the Dusk Atelier plugin (a) open BotBuilder's fullscreen UI and (b) read the current draft, through the shared `pluginStorage`. Add code only. Do not change any existing behavior, UI, storage key, or save logic.

## Contract (keep exactly — Dusk depends on it)

- Interop id: `risu-story-workshop` (regex `^[a-z0-9][a-z0-9._-]{1,63}$`). `pluginName`: `risu_story_workshop`.
- Actions (key regex `^[a-z0-9][a-z0-9_-]{0,31}$`):
  - `open`: call the same `open` closure passed to `registerButton` / `registerSetting` (`showContainer("fullscreen")` + render + first-open recovery prompt). Return `{ opened: true }`.
  - `draft`: read-only. Return `null` when there is no session draft, otherwise:
    ```ts
    {
      name: string,              // String(this.s.draft.name ?? "")
      targetId: string | null,   // this.s.targetId — chaId of the Risu character being edited; null = new draft
      started: boolean,          // !!this.started
      dirty: boolean,            // !!this.dirty()
      savedAt: string | null,    // this.slots.autosave?.savedAt (ISO)
      draft: object              // editable(this.s.draft) — only FIELDS keys
    }
    ```
  - Results must be JSON-serializable and ≤ 1 MiB (the snippet enforces this).
- Dusk detects the patched build by the marker `/*__DA_WORKSHOP_INTEROP__*/` in the plugin script, then requires `open` in the registry entry's `actions`. The marker text must appear somewhere in the final plugin .js (see below).
- Never mutate session, draft, slots or Risu data inside these actions.

## Storage protocol (implemented by the snippet — do not reimplement)

All keys live in `Risuai.pluginStorage` (shared by all plugins), JSON strings:
- `da_interop:reg:<id>` (written by BotBuilder): `{ spec:1, id, name, version, pluginName, description, fields:[], presets:[], actions:[{key,label,description}], values, appliedRev, actionRev, lastError, actionKey, actionResult, actionError, updatedAt }`
- `da_interop:action:<id>` (written by Dusk): `{ rev, key, args, updatedAt }`
- `da_interop:patch:<id>` (written by Dusk for settings sync; unused because BotBuilder registers no fields)

Flow: Dusk writes an action with `rev = max(prev.rev, reg.actionRev) + 1` → the snippet polls every 1000 ms while `document.visibilityState !== "hidden"` → when `rev > actionRev`: skip if older than 15 s (`actionError: "expired"`), otherwise run once → publish `actionRev = rev` with `actionResult` / `actionError`. Dusk waits up to 5 s (open) / 3 s (draft). Old requests found at registration are marked expired and never executed.

## Where to integrate

### Dist file (what Dusk's tools/compat/workshop-interop.mjs does)
1. Insert the snippet (end of this file) between the license comment's closing `*/` and the top-level `(() => {`, preceded by a `// /*__DA_WORKSHOP_INTEROP__*/ …` comment line.
2. Insert the registration block directly after
   `await this.api.registerButton({ name: "\uBD07\uBE4C\uB354", icon: "BB", iconType: "html", location: "hamburger" }, open);`
   inside `Workshop.init()`, where `open`, `this` (the Workshop instance) and module-scope `editable` are in scope.

Registration block as inserted:
```js
/*__DA_WORKSHOP_INTEROP__*/
registerInterop({
  id: "risu-story-workshop", name: "봇빌더", version: "1.0.1", pluginName: "risu_story_workshop",
  description: "Dusk Atelier에서 봇빌더 화면을 열고, 작업 중인 원고를 넘겨받아요.",
  actions: [
    { key: "open", label: "봇빌더 열기", run: async () => { await open(); return { opened: true }; } },
    { key: "draft", label: "작업 중인 원고 보내기", run: async () => this.s?.draft ? { name: String(this.s.draft.name ?? ""), targetId: this.s.targetId ?? null, started: !!this.started, dirty: !!this.dirty?.(), savedAt: this.slots?.autosave?.savedAt ?? null, draft: editable(this.s.draft) } : null }
  ]
}).catch((e) => console.warn("[봇빌더] DA Interop 등록 실패", e));
```

### TypeScript source (preferred for an official release)
- Put the snippet in its own module (e.g. `src/interop.ts`) exporting `registerInterop`; keep its logic equivalent.
- In `Workshop.init()`, after the menu/settings registration, call `registerInterop({...})` with the same id and actions. Do not let it block or throw out of `init()`: attach `.catch(console.warn)`.
- Map source names (`editable`, `dirty`, `started`, `s.draft`, `s.targetId`, `slots.autosave.savedAt`) to the result shape above even if they are named differently in source.
- Bundlers strip normal comments, so keep the marker as a string literal that survives the build, e.g. `export const DA_WORKSHOP_INTEROP_MARK = "/*__DA_WORKSHOP_INTEROP__*/";` and reference it (e.g. in the registration description or a console.debug) so tree-shaking keeps it. Verify the built .js contains the marker text.

## Read-only fallback Dusk uses for builds without the integration

Keys `risu-character-editor:v1:autosave`, `autosave-1`, `autosave-2`, `manual`, shape `{ schemaVersion: 1, savedAt, name, session: { targetId, draft, ... } }`. Renaming the prefix or this shape breaks the fallback; keep them if possible.

## Acceptance checks

1. Without Dusk installed, behavior is identical (no errors; only the reg key is written).
2. Writing `{"rev":N,"key":"open","updatedAt":<now>}` to `da_interop:action:risu-story-workshop` opens the UI within ~1 s, and the reg entry shows `actionRev: N, actionError: null, actionResult: {"opened": true}`.
3. Same with `key: "draft"` returns the shape above; `draft` contains only FIELDS keys (no `chats`, no `chaId`).
4. A request older than 15 s, or present at plugin start with an old timestamp, is not executed (`actionError: "expired"`).
5. Unknown key → `actionError: "unknown action: <key>"`; a throwing action → its message in `actionError`; BotBuilder keeps working.

## Snippet: DA Interop v1 with actions (authoritative copy)

The public repo https://github.com/Pyser08/dusk-atelier-interop may still have the older snippet without `actions`; use this text.

```js
/* ============================================================
 * DA Interop v1 — B 플러그인용 스니펫
 * https://github.com/Pyser08/dusk-atelier-interop
 *
 * 이 블록을 플러그인 코드에 붙여 넣고, 그 아래에서 registerInterop({...})을 부르세요.
 * (registerInterop을 부르는 코드보다 반드시 위에 있어야 합니다)
 * 공식 플러그인 API(pluginStorage)만 사용합니다.
 *
 * 저장 위치 (pluginStorage, 모든 플러그인 공용)
 *   da_interop:reg:<id>     ← 이 플러그인이 등록 (스키마·현재값·동작 결과)
 *   da_interop:patch:<id>   ← Dusk Atelier가 기록 (적용할 값)
 *   da_interop:action:<id>  ← Dusk Atelier가 기록 (실행할 동작, 선택 기능)
 * ============================================================ */
const registerInterop = (() => {
  const SPEC = 1;
  const REG = 'da_interop:reg:';
  const PATCH = 'da_interop:patch:';
  const ACTION = 'da_interop:action:';
  const POLL_MS = 3000;
  const ACTION_POLL_MS = 1000;
  const ACTION_TTL_MS = 15000;     // 이보다 오래된 동작 요청은 실행하지 않는다 (플러그인을 나중에 켰을 때 갑자기 실행되지 않게)
  const RESULT_MAX = 1048576;      // 동작 결과는 1MiB까지
  const R = globalThis.Risuai ?? globalThis.risuai ?? globalThis.__pluginApis__;

  const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
  // pluginStorage는 모든 플러그인이 함께 쓰는 저장소라 키 하나에 자기 항목만 둔다
  async function readKey(key) {
    try {
      const raw = await R.pluginStorage.getItem(key);
      return raw == null || raw === '' ? null : typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { return null; }
  }
  const writeKey = (key, value) => R.pluginStorage.setItem(key, JSON.stringify(value));

  function normalize(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('[DA Interop] 설정 객체가 필요합니다');
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(cfg.id ?? '')) throw new Error('[DA Interop] id 형식 오류: ' + cfg.id);
    const actions = (Array.isArray(cfg.actions) ? cfg.actions : [])
      .filter((a) => a && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(a.key ?? '') && typeof a.run === 'function');
    if (typeof cfg.apply !== 'function' && !actions.length) throw new Error('[DA Interop] apply 함수가 필요합니다');
    return {
      id: cfg.id,
      name: cfg.name ?? cfg.id,
      version: String(cfg.version ?? ''),
      pluginName: cfg.pluginName ?? '',
      description: cfg.description ?? '',
      fields: Array.isArray(cfg.fields) ? cfg.fields : [],
      presets: Array.isArray(cfg.presets) ? cfg.presets : [],
      apply: typeof cfg.apply === 'function' ? cfg.apply : async () => {},
      getValues: typeof cfg.getValues === 'function' ? cfg.getValues : null,
      actions,
    };
  }

  return async function registerInterop(rawCfg) {
    if (!R?.pluginStorage?.getItem) {
      console.warn('[DA Interop] 플러그인 API를 찾지 못해 등록을 건너뜁니다');
      return null;
    }
    const cfg = normalize(rawCfg);
    let appliedRev = 0;
    let actionRev = 0;
    let busy = false;
    let lastError = null;   // 마지막 apply 결과
    let lastAction = {};    // 마지막 동작 결과 { actionKey, actionResult, actionError }

    const currentValues = async () => {
      if (cfg.getValues) {
        try { return clone(await cfg.getValues()); } catch (e) { console.warn('[DA Interop] getValues 실패', e); }
      }
      return Object.fromEntries(cfg.fields.map((f) => [f.key, f.default ?? null]));
    };

    const publish = async (extra = {}) => {
      const prev = await readKey(REG + cfg.id);
      if (prev?.appliedRev) appliedRev = Math.max(appliedRev, prev.appliedRev);
      if (prev?.actionRev) actionRev = Math.max(actionRev, prev.actionRev);
      return writeKey(REG + cfg.id, {
        spec: SPEC,
        id: cfg.id,
        name: cfg.name,
        version: cfg.version,
        pluginName: cfg.pluginName,
        description: cfg.description,
        fields: clone(cfg.fields),
        presets: clone(cfg.presets),
        actions: cfg.actions.map((a) => ({ key: a.key, label: a.label ?? a.key, description: a.description ?? '' })),
        values: await currentValues(),
        appliedRev,
        actionRev,
        lastError,
        ...lastAction,
        ...extra,
        updatedAt: Date.now(),
      });
    };

    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const patch = await readKey(PATCH + cfg.id);
        if (!patch || !(patch.rev > appliedRev)) return;
        lastError = null;
        try {
          await cfg.apply(clone(patch.values ?? {}), { preset: patch.preset ?? null, rev: patch.rev, source: 'dusk-atelier' });
        } catch (e) {
          lastError = String(e?.message ?? e);
          console.warn('[DA Interop] apply 실패', e);
        }
        appliedRev = patch.rev;
        await publish();
      } finally {
        busy = false;
      }
    };

    // 동작(선택 기능): Dusk Atelier가 '화면 열기' 같은 일을 부탁하면 한 번만 실행하고 결과를 돌려준다
    const checkAction = async () => {
      if (busy || !cfg.actions.length) return;
      busy = true;
      try {
        const req = await readKey(ACTION + cfg.id);
        if (!req || !(req.rev > actionRev)) return;
        actionRev = req.rev;
        const act = cfg.actions.find((a) => a.key === req.key);
        let actionResult = null, actionError = null;
        if (!act) actionError = 'unknown action: ' + req.key;
        else if (!(Date.now() - (req.updatedAt ?? 0) <= ACTION_TTL_MS)) actionError = 'expired';
        else {
          try {
            const out = await act.run(clone(req.args ?? null), { rev: req.rev, source: 'dusk-atelier' });
            actionResult = out === undefined ? null : clone(out);
            if (JSON.stringify(actionResult).length > RESULT_MAX) { actionResult = null; actionError = 'result too large'; }
          } catch (e) {
            actionError = String(e?.message ?? e);
            console.warn('[DA Interop] action 실패', e);
          }
        }
        lastAction = { actionKey: req.key, actionResult, actionError };
        await publish();
      } finally {
        busy = false;
      }
    };

    // 처음 등록할 때 남아 있던 오래된 동작 요청은 실행하지 않고 넘긴다
    await publish();
    const stale = await readKey(ACTION + cfg.id);
    if (stale?.rev > actionRev && !(Date.now() - (stale.updatedAt ?? 0) <= ACTION_TTL_MS)) {
      actionRev = stale.rev;
      lastAction = { actionKey: stale.key ?? null, actionResult: null, actionError: 'expired' };
      await publish();
    }
    await check();
    await checkAction();
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    setInterval(() => { if (visible()) check().catch(() => {}); }, POLL_MS);
    if (cfg.actions.length) setInterval(() => { if (visible()) checkAction().catch(() => {}); }, ACTION_POLL_MS);

    return {
      /** 값이 플러그인 쪽에서 바뀌었을 때 호출하면 Dusk Atelier 화면도 갱신된다 */
      refresh: () => publish(),
    };
  };
})();
```
