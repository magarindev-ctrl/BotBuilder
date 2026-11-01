// SPDX-License-Identifier: GPL-3.0-only
// DA Interop v1: lets Dusk Atelier open 봇빌더 and read the current draft through the shared
// pluginStorage. Protocol by Pyser08 (https://github.com/Pyser08/dusk-atelier-interop), implemented
// here with the plugin's own storage access. Nothing in this module changes a session, a draft or Risu data.
export const DA_WORKSHOP_INTEROP_MARK = '/*__DA_WORKSHOP_INTEROP__*/';
export const INTEROP_SPEC = 1;
export const INTEROP_KEYS = { reg: 'da_interop:reg:', patch: 'da_interop:patch:', action: 'da_interop:action:' };
export const INTEROP_POLL_MS = 3000;
export const INTEROP_ACTION_POLL_MS = 1000;
export const INTEROP_ACTION_TTL_MS = 15000;
export const INTEROP_RESULT_MAX = 1048576;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const clone = value => JSON.parse(JSON.stringify(value ?? null));

export function normalizeInterop(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('[DA Interop] 설정 객체가 필요합니다');
  if (!ID_PATTERN.test(cfg.id ?? '')) throw new Error('[DA Interop] id 형식 오류: ' + cfg.id);
  const actions = (Array.isArray(cfg.actions) ? cfg.actions : []).filter(action => action && KEY_PATTERN.test(action.key ?? '') && typeof action.run === 'function');
  if (typeof cfg.apply !== 'function' && !actions.length) throw new Error('[DA Interop] apply 함수가 필요합니다');
  return {
    id: cfg.id, name: cfg.name ?? cfg.id, version: String(cfg.version ?? ''), pluginName: cfg.pluginName ?? '', description: cfg.description ?? '',
    fields: Array.isArray(cfg.fields) ? cfg.fields : [], presets: Array.isArray(cfg.presets) ? cfg.presets : [],
    apply: typeof cfg.apply === 'function' ? cfg.apply : async () => {}, getValues: typeof cfg.getValues === 'function' ? cfg.getValues : null, actions,
  };
}

// storage: the host's pluginStorage. options let tests inject time, visibility and timers.
export async function registerInterop(storage, rawCfg, options = {}) {
  if (!storage?.getItem || !storage?.setItem) { console.warn('[DA Interop] 플러그인 API를 찾지 못해 등록을 건너뜁니다'); return null; }
  const cfg = normalizeInterop(rawCfg);
  const now = options.now ?? (() => Date.now());
  const visible = options.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const timers = options.timers ?? { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id) };
  let appliedRev = 0, actionRev = 0, busy = false, lastError = null, lastAction = {}, stopped = false;
  const readKey = async key => {
    try { const raw = await storage.getItem(key); return raw == null || raw === '' ? null : typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  };
  const writeKey = (key, value) => storage.setItem(key, JSON.stringify(value));
  const currentValues = async () => {
    if (cfg.getValues) { try { return clone(await cfg.getValues()); } catch (error) { console.warn('[DA Interop] getValues 실패', error); } }
    return Object.fromEntries(cfg.fields.map(field => [field.key, field.default ?? null]));
  };
  const publish = async (extra = {}) => {
    const previous = await readKey(INTEROP_KEYS.reg + cfg.id);
    if (previous?.appliedRev) appliedRev = Math.max(appliedRev, previous.appliedRev);
    if (previous?.actionRev) actionRev = Math.max(actionRev, previous.actionRev);
    return writeKey(INTEROP_KEYS.reg + cfg.id, {
      spec: INTEROP_SPEC, id: cfg.id, name: cfg.name, version: cfg.version, pluginName: cfg.pluginName, description: cfg.description,
      fields: clone(cfg.fields), presets: clone(cfg.presets),
      actions: cfg.actions.map(action => ({ key: action.key, label: action.label ?? action.key, description: action.description ?? '' })),
      values: await currentValues(), appliedRev, actionRev, lastError, ...lastAction, ...extra, updatedAt: now(),
    });
  };
  const fresh = request => now() - (request.updatedAt ?? 0) <= INTEROP_ACTION_TTL_MS;
  // Settings sync: Dusk writes a patch; 봇빌더 registers no fields, so apply is a no-op but the revision is still acknowledged.
  const check = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const patch = await readKey(INTEROP_KEYS.patch + cfg.id);
      if (!patch || !(patch.rev > appliedRev)) return;
      lastError = null;
      try { await cfg.apply(clone(patch.values ?? {}), { preset: patch.preset ?? null, rev: patch.rev, source: 'dusk-atelier' }); }
      catch (error) { lastError = String(error?.message ?? error); console.warn('[DA Interop] apply 실패', error); }
      appliedRev = patch.rev;
      await publish();
    } finally { busy = false; }
  };
  // Actions: each request runs at most once; stale requests are acknowledged as expired without running.
  const checkAction = async () => {
    if (busy || stopped || !cfg.actions.length) return;
    busy = true;
    try {
      const request = await readKey(INTEROP_KEYS.action + cfg.id);
      if (!request || !(request.rev > actionRev)) return;
      actionRev = request.rev;
      const action = cfg.actions.find(candidate => candidate.key === request.key);
      let actionResult = null, actionError = null;
      if (!action) actionError = 'unknown action: ' + request.key;
      else if (!fresh(request)) actionError = 'expired';
      else {
        try {
          const output = await action.run(clone(request.args ?? null), { rev: request.rev, source: 'dusk-atelier' });
          actionResult = output === undefined ? null : clone(output);
          if (JSON.stringify(actionResult).length > INTEROP_RESULT_MAX) { actionResult = null; actionError = 'result too large'; }
        } catch (error) { actionError = String(error?.message ?? error); console.warn('[DA Interop] action 실패', error); }
      }
      lastAction = { actionKey: request.key, actionResult, actionError };
      await publish();
    } finally { busy = false; }
  };
  await publish();
  const stale = await readKey(INTEROP_KEYS.action + cfg.id);
  if (stale?.rev > actionRev && !fresh(stale)) {
    actionRev = stale.rev;
    lastAction = { actionKey: stale.key ?? null, actionResult: null, actionError: 'expired' };
    await publish();
  }
  await check();
  await checkAction();
  const handles = [timers.setInterval(() => { if (visible()) check().catch(() => {}); }, INTEROP_POLL_MS)];
  if (cfg.actions.length) handles.push(timers.setInterval(() => { if (visible()) checkAction().catch(() => {}); }, INTEROP_ACTION_POLL_MS));
  return {
    refresh: () => publish(),
    poll: async () => { await check(); await checkAction(); },
    stop: () => { stopped = true; for (const handle of handles) timers.clearInterval(handle); },
  };
}
