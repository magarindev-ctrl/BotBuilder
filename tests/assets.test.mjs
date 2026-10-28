import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { blankCharacter, clone, removeAdditionalAssets, sessionFromCharacter, saveExisting, snapshot, restoreSnapshot } from '../src/core.js';
import { exportCharx, importCharx, unpack } from '../src/charx.js';

function fixture() {
  const c = blankCharacter();
  c.image = 'portrait'; c.emotionImages = [['happy', 'emotion']];
  c.additionalAssets = [['one', 'shared', 'png'], ['two', 'two', 'png'], ['three', 'shared', 'png']];
  c.ccAssets = [{ type: 'icon', name: 'main', uri: 'embeded://portrait' }, { type: 'emotion', name: 'happy', uri: 'embeded://emotion' }, ...c.additionalAssets.map(a => ({ type: 'x-risu-asset', name: a[0], uri: 'embeded://' + a[0] }))];
  return c;
}
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
  await assert.rejects(exportCharx(api, result, imported.cardMeta), /보존할 수 없는/);
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
