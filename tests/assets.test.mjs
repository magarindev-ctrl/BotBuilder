import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8, Unzip } from 'fflate';
import { blankCharacter, clone, removeAdditionalAssets, withCharacterIcon, mergeCharacter, sessionFromCharacter, saveExisting, snapshot, restoreSnapshot } from '../src/core.js';
import { exportCharx, importCharx, unpack } from '../src/charx.js';

function fixture() {
  const c = blankCharacter();
  c.image = 'portrait'; c.emotionImages = [['happy', 'emotion']];
  c.additionalAssets = [['one', 'shared', 'png'], ['two', 'two', 'png'], ['three', 'shared', 'png']];
  c.ccAssets = [{ type: 'icon', name: 'main', uri: 'embeded://portrait' }, { type: 'emotion', name: 'happy', uri: 'embeded://emotion' }, ...c.additionalAssets.map(a => ({ type: 'x-risu-asset', name: a[0], uri: 'embeded://' + a[0] }))];
  return c;
}
// The public RisuRealm upload parser (D8DZxZId.js, checked 2026-10-29)
// assigns iconData for entries whose name startsWith('assets/icon/image').
function realmThumbnail(archive) {
  let icon = null;
  const reader = new Unzip(file => {
    const chunks = [];
    file.ondata = (error, bytes, final) => {
      if (error) throw error;
      chunks.push(bytes);
      if (final && file.name.startsWith('assets/icon/image')) icon = Uint8Array.from(chunks.flatMap(chunk => [...chunk]));
    };
    file.start();
  });
  reader.push(archive, true);
  return icon;
}
const portraitPng = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
test('icon replacement and removal clean old icon metadata, preserve other assets and survive recovery/export', async () => {
  const c=fixture(), original=clone(c), session=sessionFromCharacter(c);
  session.draft=withCharacterIcon(session.draft,'new-portrait');
  const restored=restoreSnapshot(snapshot(session));
  assert.equal(restored.draft.image,'new-portrait');assert.deepEqual(c,original);
  assert.deepEqual(restored.draft.additionalAssets,c.additionalAssets);assert.deepEqual(restored.draft.emotionImages,c.emotionImages);
  assert.ok(!restored.draft.ccAssets.some(a=>a.type==='icon'&&a.name==='main'));
  let reads=[];const api={readImage:async path=>{reads.push(path);return portraitPng;}};
  await exportCharx(api,restored.draft);assert.ok(reads.includes('new-portrait'));assert.ok(!reads.includes(c.image));
  const removed=withCharacterIcon(restored.draft,'');reads=[];
  const {card}=unpack(await exportCharx(api,removed));
  assert.ok(!card.data.assets.some(a=>a.type==='icon'));assert.ok(!reads.includes('new-portrait'));
});
test('host save includes icon edits, preserves concurrent unrelated changes, and detects conflicting icon edits', async () => {
  const c=fixture(),session=sessionFromCharacter(c);session.draft=withCharacterIcon(session.draft,'new');
  let current=clone(c);current.desc='external description';current.chats[0].message.push({data:'keep'});
  const api={getDatabase:async()=>({characters:[current]}),getCharacterFromIndex:async()=>clone(current),setCharacterToIndex:async(_,value)=>{current=clone(value);}};
  const result=await saveExisting(api,session);assert.deepEqual(result.conflicts,[]);
  assert.equal(current.image,'new');assert.equal(current.desc,'external description');assert.equal(current.chats[0].message[0].data,'keep');
  const fresh=clone(c);fresh.image='external icon';assert.ok(mergeCharacter(session.base,session.draft,fresh).conflicts.includes('image'));
});
test('representative image is discoverable by the Realm path selector and referenced by card.json', async () => {
  const c = blankCharacter(); c.image = 'assets/portrait';
  const archive = await exportCharx({ readImage: async path => { assert.equal(path,c.image); return portraitPng; } }, c);
  const {card,files} = unpack(archive), icon = card.data.assets.find(a => a.type === 'icon' && a.name === 'main');
  assert.equal(icon.uri,'embeded://assets/icon/image/main.png');
  assert.deepEqual(files[icon.uri.slice('embeded://'.length)],portraitPng);
  assert.deepEqual(realmThumbnail(archive),portraitPng);
  const imported = await importCharx({saveAsset: async bytes => { assert.deepEqual(bytes,portraitPng); return 'assets/restored'; }},archive);
  assert.equal(imported.character.image,'assets/restored');
});
test('a shared portrait is embedded once and remains discoverable with emotion and other image references', async () => {
  const c=blankCharacter();c.image='portrait';c.emotionImages=[['happy','portrait']];c.additionalAssets=[['shared','portrait','png'],['other','other','png']];
  const reads=[];
  const archive=await exportCharx({readImage:async path=>{reads.push(path);return path==='portrait'?portraitPng:new Uint8Array([9,8,7]);}},c);
  const {card,files}=unpack(archive);
  assert.deepEqual(reads,['portrait','other']);
  assert.equal(Object.keys(files).filter(p=>p.startsWith('assets/')).length,2);
  assert.ok(card.data.assets.slice(0,3).every(a=>a.uri==='embeded://assets/icon/image/main.png'));
  assert.deepEqual(realmThumbnail(archive),portraitPng);
});
test('a character without a portrait does not present an additional asset as its Realm icon', async () => {
  const c=blankCharacter();c.additionalAssets=[['main','other','png']];
  const archive=await exportCharx({readImage:async()=>portraitPng},c);
  assert.equal(realmThumbnail(archive),null);
  assert.equal(unpack(archive).card.data.assets.some(a=>a.type==='icon'),false);
});
test('bulk removal preserves order, shared references, portrait and emotions without mutating input', () => {
  const c = fixture(), original = clone(c);
  const result = removeAdditionalAssets(c, [c.additionalAssets[0], c.additionalAssets[1]]);
  assert.deepEqual(c, original);
  assert.deepEqual(result.additionalAssets, [c.additionalAssets[2]]);
  assert.deepEqual(result.ccAssets.map(a => a.name), ['main', 'happy', 'three']);
  assert.equal(result.image, c.image); assert.deepEqual(result.emotionImages, c.emotionImages);
  assert.throws(() => removeAdditionalAssets(result, [c.additionalAssets[0]]), /목록이 변경/);
  const all = removeAdditionalAssets(result, result.additionalAssets);
  assert.deepEqual(all.additionalAssets, []); assert.equal(all.ccAssets.length, 2);
});
test('duplicate names retain metadata until the last registration is removed; unknown metadata is preserved', () => {
  const c = fixture(); c.additionalAssets.push(['one', 'other', 'png']);
  c.ccAssets.push({ type: 'other', name: 'unknown', uri: 'external' });
  const result = removeAdditionalAssets(c, [c.additionalAssets[0]]);
  assert.ok(result.ccAssets.some(a => a.name === 'one'));
  assert.ok(result.ccAssets.some(a => a.name === 'unknown'));
  assert.equal(Object.hasOwn(removeAdditionalAssets(blankCharacter(), []), 'ccAssets'), false);
});
test('import, delete and export removes original card metadata references and never reads removed assets', async () => {
  const api = { readImage: async () => new Uint8Array([1, 2, 3]) };
  const original = await exportCharx(api, fixture()); let saved = 0;
  const imported = await importCharx({ saveAsset: async () => 'saved/' + saved++ }, original);
  const cardMeta = clone(imported.cardMeta), c = imported.character;
  const result = removeAdditionalAssets(c, [c.additionalAssets[1]]), reads = [];
  const output = await exportCharx({ readImage: async path => { reads.push(path); return new Uint8Array([1, 2, 3]); } }, result, imported.cardMeta);
  assert.deepEqual(unpack(output).card.data.assets.map(a => a.name), ['main', 'happy', 'one', 'three']);
  assert.ok(!reads.includes(c.additionalAssets[1][1])); assert.equal(reads.length, 3);
  assert.deepEqual(imported.cardMeta, cardMeta);
  result.ccAssets.push({ type: 'other', name: 'unknown', uri: 'external' });
  const localReads=[];
  const localOutput=await exportCharx({readImage:async path=>{localReads.push(path);return portraitPng;}}, result, imported.cardMeta);
  assert.ok(localReads.includes('external'));
  assert.ok(unpack(localOutput).card.data.assets.find(a=>a.name==='unknown').uri.startsWith('embeded://'));
});
test('deletion survives recovery and host save while concurrent additions and chats survive', async () => {
  const original = fixture(), session = sessionFromCharacter(original);
  session.draft = removeAdditionalAssets(session.draft, session.draft.additionalAssets.slice(0, 2));
  const recovered = restoreSnapshot(snapshot(session)); let current = clone(original);
  current.additionalAssets.push(['new', 'new-path', 'png']);
  current.ccAssets.push({ type: 'x-risu-asset', name: 'new', uri: 'new-path' });
  current.chats[0].message.push({ role: 'user', data: 'latest' });
  const api = { getDatabase: async () => ({ characters: [current] }), getCharacterFromIndex: async () => clone(current), setCharacterToIndex: async (_, value) => { current = clone(value); } };
  const result = await saveExisting(api, recovered);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(current.additionalAssets.map(a => a[0]), ['three', 'new']);
  assert.deepEqual(current.ccAssets.map(a => a.name), ['main', 'happy', 'three', 'new']);
  assert.equal(current.chats[0].message[0].data, 'latest');
});
test('charx export accepts more than 100MiB of asset bytes and retains import safeguards', async () => {
  const c = blankCharacter(), size = 100 * 1024 * 1024 + 1;
  c.additionalAssets = [['large', 'large-path', 'png']];
  const bytes = new Uint8Array(size); bytes[0] = 12; bytes[size - 1] = 34;
  const archive = await exportCharx({ readImage: async () => bytes }, c);
  assert.ok(archive.length > size);
  const entries = [];
  const files = unzipSync(archive, { filter: entry => { entries.push({ name: entry.name, size: entry.originalSize }); return entry.name === 'card.json'; } });
  assert.equal(entries.find(e => e.name === 'assets/0.png').size, size);
  assert.equal(JSON.parse(strFromU8(files['card.json'])).data.assets[0].name, 'large');
  assert.throws(() => unpack(archive), /charx 입력은 100MiB/);
});
