import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { rpackMap } from './rpack-map.js';
import { assert, blankCharacter, clone, editable, uid, tick, luaFirstTriggers } from './core.js';

const MAX_ARCHIVE = 100 * 1024 * 1024, MAX_EXPANDED = 200 * 1024 * 1024;
function json(data) { assert(data && data.length <= 8 * 1024 * 1024, '메타데이터가 없거나 8MiB 상한을 초과했습니다.'); return JSON.parse(strFromU8(data)); }
export function decodeModule(data) {
  assert(data.length >= 7 && data[0] === 111 && data[1] === 0, '지원하지 않는 module.risum 형식입니다.');
  const size = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(2, true);
  assert(size <= 8 * 1024 * 1024 && size + 6 < data.length, 'module.risum 길이가 올바르지 않습니다.');
  const decoded = data.slice(6, 6 + size).map(x => rpackMap[x + 256]);
  const payload = json(decoded); assert(payload.type === 'risuModule' && payload.module, '모듈 메타데이터가 올바르지 않습니다.');
  assert(!(payload.module.assets?.length), '별도 모듈 에셋이 있는 charx는 이 버전에서 불러올 수 없습니다. RisuBard 본체로 먼저 가져온 뒤 현재 캐릭터 불러오기를 사용하세요.');
  return payload.module;
}
export function encodeModule(character, original = null) {
  const payload = strToU8(JSON.stringify({ type: 'risuModule', module: { id: uid(), name: character.name + ' Module', description: '', ...(original ?? {}), lorebook: character.globalLore ?? [], regex: character.customscript ?? [], trigger: luaFirstTriggers(character.triggerscript ?? []), assets: [] } }));
  const result = new Uint8Array(7 + payload.length); result[0] = 111; result[1] = 0;
  new DataView(result.buffer).setUint32(2, payload.length, true);
  result.set(payload.map(x => rpackMap[x]), 6); result[result.length - 1] = 0;
  return result;
}
export function unpack(bytes) {
  assert(bytes.length <= MAX_ARCHIVE, 'charx 입력은 100MiB 이하만 지원합니다.');
  let total = 0, count = 0;
  const files = unzipSync(bytes, { filter: entry => { total += entry.originalSize; count++; assert(total <= MAX_EXPANDED && count <= 5000, '압축 해제 크기·파일 수 한도를 초과했습니다.'); assert(!entry.name.split('/').includes('..') && !entry.name.startsWith('/'), '파일 경로가 올바르지 않습니다.'); return true; } });
  const card = json(files['card.json']);
  assert(['chara_card_v3', 'chara_card_v2'].includes(card.spec) && card.data, '지원하지 않는 캐릭터 카드 형식입니다.');
  const module = files['module.risum'] ? decodeModule(files['module.risum']) : null;
  return { card, module, files };
}
export function cardToCharacter(card, module = null) {
  const d = card.data, r = d.extensions?.risuai ?? {}, c = blankCharacter();
  const map = { name: 'name', description: 'desc', personality: 'personality', scenario: 'scenario', first_mes: 'firstMessage', mes_example: 'exampleMessage', creator_notes: 'creatorNotes', system_prompt: 'systemPrompt', post_history_instructions: 'replaceGlobalNote', alternate_greetings: 'alternateGreetings', tags: 'tags', creator: 'creator', character_version: 'characterVersion', group_only_greetings: 'group_only_greetings', nickname: 'nickname', source: 'source', creation_date: 'creation_date', modification_date: 'modification_date' };
  for (const [key, field] of Object.entries(map)) if (key in d) c[field] = clone(d[key]);
  for (const field of ['bias', 'viewScreen', 'utilityBot', 'sdData', 'backgroundHTML', 'license', 'additionalText', 'largePortrait', 'lorePlus', 'inlayViewScreen', 'newGenData', 'defaultVariables', 'prebuiltAssetCommand', 'prebuiltAssetExclude', 'prebuiltAssetStyle', 'moduleNamespace', 'hideChatIcon', 'onboarding']) if (field in r) c[field] = clone(r[field]);
  c.lowLevelAccess = false; // File import must not grant executable low-level permissions.
  c.customscript = clone(module?.regex ?? r.customScripts ?? []);
  c.triggerscript = clone(module?.trigger ?? r.triggerscript ?? []);
  c.globalLore = clone(module?.lorebook ?? (d.character_book?.entries ?? []).map(e => ({ key: (e.keys ?? []).join(','), secondkey: (e.secondary_keys ?? []).join(','), content: e.content ?? '', comment: e.name ?? e.comment ?? '', insertorder: e.insertion_order ?? 100, mode: e.mode ?? 'normal', alwaysActive: !!e.constant, selective: !!e.selective, useRegex: !!e.use_regex, extentions: clone(e.extensions ?? {}), activationPercent: e.extensions?.risu_activationPercent, folder: e.folder, id: e.id })));
  c.loreExt = clone(d.character_book?.extensions ?? {});
  c.loreSettings = { scanDepth: d.character_book?.scan_depth ?? 2, tokenBudget: d.character_book?.token_budget ?? 512, recursiveScanning: d.character_book?.recursive_scanning ?? false, fullWordMatching: d.character_book?.extensions?.risu_fullWordMatching ?? false };
  c.extentions = clone(d.extensions ?? {}); delete c.extentions.risuai;
  c.ccAssets = clone(d.assets ?? []);
  assert(typeof c.name === 'string' && typeof c.desc === 'string' && typeof c.firstMessage === 'string', '카드 본문 형식이 올바르지 않습니다.');
  for (const field of ['customscript', 'triggerscript', 'globalLore']) assert(Array.isArray(c[field]), '카드 배열 형식 오류: ' + field);
  c.triggerscript = luaFirstTriggers(c.triggerscript);
  return c;
}
export function characterToCard(c, original = null) {
  const card = original ? clone(original) : { spec: 'chara_card_v3', spec_version: '3.0', data: {} };
  card.spec = 'chara_card_v3'; card.spec_version = '3.0';
  const d = card.data;
  Object.assign(d, { name: c.name, description: c.desc ?? '', personality: c.personality ?? '', scenario: c.scenario ?? '', first_mes: c.firstMessage ?? '', mes_example: c.exampleMessage ?? '', creator_notes: c.creatorNotes ?? '', system_prompt: c.systemPrompt ?? '', post_history_instructions: c.replaceGlobalNote ?? c.postHistoryInstructions ?? '', alternate_greetings: c.alternateGreetings ?? [], tags: c.tags ?? [], creator: c.creator ?? '', character_version: c.characterVersion ?? '', group_only_greetings: c.group_only_greetings ?? [], nickname: c.nickname ?? '', source: c.source ?? [] });
  d.character_book = { ...(d.character_book ?? {}), scan_depth: c.loreSettings?.scanDepth, token_budget: c.loreSettings?.tokenBudget, recursive_scanning: c.loreSettings?.recursiveScanning, extensions: c.loreExt ?? {}, entries: (c.globalLore ?? []).map(l => ({ keys: (l.key ?? '').split(',').map(x => x.trim()), secondary_keys: l.selective ? (l.secondkey ?? '').split(',').map(x => x.trim()) : [], content: l.content, extensions: { ...l.extentions, risu_activationPercent: l.activationPercent }, enabled: true, insertion_order: l.insertorder, constant: l.alwaysActive, selective: l.selective, name: l.comment, comment: l.comment, case_sensitive: !!l.extentions?.risu_case_sensitive, use_regex: !!l.useRegex, mode: l.mode, folder: l.folder, id: l.id })) };
  d.extensions = { ...(d.extensions ?? {}), ...(c.extentions ?? {}), risuai: { ...(d.extensions?.risuai ?? {}) } };
  const r = d.extensions.risuai;
  for (const field of ['bias', 'viewScreen', 'utilityBot', 'sdData', 'backgroundHTML', 'license', 'additionalText', 'largePortrait', 'lorePlus', 'inlayViewScreen', 'newGenData', 'lowLevelAccess', 'defaultVariables', 'prebuiltAssetCommand', 'prebuiltAssetExclude', 'prebuiltAssetStyle', 'moduleNamespace', 'hideChatIcon', 'onboarding']) if (c[field] !== undefined) r[field] = clone(c[field]);
  delete r.customScripts; delete r.triggerscript;
  return card;
}
export async function importCharx(api, data) {
  const { card, module, files } = unpack(data), character = cardToCharacter(card, module);
  const paths = new Map();
  const save = async uri => {
    const path = uri.replace(/^embeded:\/\//, '');
    assert(files[path], '카드가 참조하는 에셋이 없습니다: ' + path);
    if (!paths.has(path)) { await tick(); paths.set(path, await api.saveAsset(files[path])); }
    return paths.get(path);
  };
  character.additionalAssets = [];
  for (const asset of card.data.assets ?? []) {
    assert(typeof asset.uri === 'string', '에셋 URI가 없습니다.');
    if (!asset.uri.startsWith('embeded://')) { if (asset.uri === 'ccdefault:') continue; throw new Error('외부 에셋은 자동 다운로드하지 않습니다: ' + asset.uri); }
    const path = await save(asset.uri);
    if (asset.type === 'icon' && asset.name === 'main') character.image = path;
    else if (asset.type === 'emotion') character.emotionImages.push([asset.name, path]);
    else character.additionalAssets.push([asset.name, path, asset.ext ?? 'png']);
  }
  // Legacy cards may keep asset references only in the RisuAI extension.
  for (const tuple of card.data.extensions?.risuai?.additionalAssets ?? []) {
    if (!character.additionalAssets.some(a => a[0] === tuple[0])) {
      const path = tuple[1]?.startsWith('embeded://') ? await save(tuple[1]) : null;
      assert(path, '이전 형식의 내장 에셋을 해석할 수 없습니다. 본체로 먼저 가져와 주세요.');
      character.additionalAssets.push([tuple[0], path, tuple[2] ?? 'png']);
    }
  }
  return { character, cardMeta: { card, module } };
}
async function assetBytes(api, path) {
  const value = await api.readImage(path);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (typeof value === 'string' && value.startsWith('data:') && value.includes(';base64,')) return Uint8Array.from(atob(value.split(',')[1]), x => x.charCodeAt(0));
  throw new Error('에셋을 읽을 수 없습니다: ' + path);
}
export async function exportCharx(api, character, cardMeta) {
  const card = characterToCard(character, cardMeta?.card), files = {}, assets = [], refs = new Map();
  const names = (character.additionalAssets ?? []).map(a => a[0]);
  assert(names.every(n => typeof n === 'string' && n.trim()) && new Set(names).size === names.length, '에셋 이름이 비어 있거나 중복됩니다. 목록에서 수정해 주세요.');
  async function add(type, name, path, ext) {
    assert(typeof path === 'string' && path, '누락된 에셋 참조: ' + name);
    const suffix = /^[a-zA-Z0-9]{1,8}$/.test(ext ?? '') ? ext : 'bin';
    let file = refs.get(path);
    if (!file) {
      // RisuRealm's charx thumbnail reader selects this directory, not card.json's icon URI.
      file = type === 'icon' && name === 'main'
        ? `assets/icon/image/main.${suffix}`
        : `assets/${refs.size}.${suffix}`;
      await tick(); const data = await assetBytes(api, path);
      files[file] = data; refs.set(path, file);
    }
    assets.push({ type, name, uri: 'embeded://' + file, ext: suffix });
  }
  if (character.image) await add('icon', 'main', character.image, 'png');
  for (const a of character.emotionImages ?? []) await add('emotion', a[0], a[1], 'png');
  for (const a of character.additionalAssets ?? []) {
    const original = cardMeta?.card?.data?.assets?.find(asset => asset.name === a[0]);
    await add(original?.type ?? 'x-risu-asset', a[0], a[1], a[2]);
  }
  // Keep other CCv3 asset metadata when the referenced bytes have a host mapping.
  for (const asset of character.ccAssets ?? []) {
    if (assets.some(a => a.name === asset.name)) continue;
    if (asset.uri === 'ccdefault:') continue;
    const tuple = character.additionalAssets?.find(a => a[0] === asset.name);
    if (tuple) await add(asset.type, asset.name, tuple[1], asset.ext);
    else throw new Error('보존할 수 없는 CCv3 에셋 참조입니다: ' + asset.name + '. 본체 내보내기를 사용하세요.');
  }
  card.data.assets = assets;
  delete card.data.extensions.risuai.additionalAssets;
  files['card.json'] = strToU8(JSON.stringify(card, null, 2));
  files['module.risum'] = encodeModule(character, cardMeta?.module);
  await tick();
  return zipSync(files, { level: 0 });
}
