// Source-contract checks only; this does not install or exercise a RisuAI plugin.
// Run: node --experimental-transform-types verification/verify-contracts.mjs
// Requires Node 24+ and network access to the pinned public sources below.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';

const risuCommit = 'f50b5942ec6aa59aa3c56049ac687ca09667fec7';
const storagePath = 'src/ts/process/pluginStorageStore.ts';
const storageUrl = `https://raw.githubusercontent.com/kwaroran/Risuai/${risuCommit}/${storagePath}`;
const expectedStorageBlob = '8cf7d67be41604cdb99aab76109d00f1e871cf25';
const re2Version = '2.9.0';
const checks = [];
async function check(name, fn) {
  const start = performance.now();
  try {
    const evidence = await fn();
    checks.push({ name, passed: true, durationMs: Math.round((performance.now() - start) * 100) / 100, evidence });
  } catch (error) {
    checks.push({ name, passed: false, error: String(error.stack || error).slice(0,2500) });
  }
}
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} downloading ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
function tarFile(tar, wanted) {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    if (name === wanted) return tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Missing package entry: ${wanted}`);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'risuai-contracts-'));
const storageBytes = await download(storageUrl);
const storageBlob = createHash('sha1').update(`blob ${storageBytes.length}\0`).update(storageBytes).digest('hex');
assert.equal(storageBlob, expectedStorageBlob, 'RisuAI source must match the inspected Git blob');
await writeFile(join(temporaryDirectory, 'pluginStorageStore.ts'), storageBytes);
const { PluginStorageStore, defaultPluginStorageOptions } = await import(pathToFileURL(join(temporaryDirectory, 'pluginStorageStore.ts')).href);

const packageInfo = JSON.parse((await download(`https://registry.npmjs.org/re2js/${re2Version}`)).toString());
const packageBytes = await download(packageInfo.dist.tarball);
const integrity = `sha512-${createHash('sha512').update(packageBytes).digest('base64')}`;
assert.equal(integrity, packageInfo.dist.integrity, 'RE2JS package integrity mismatch');
const packageTar = gunzipSync(packageBytes);
const re2Bytes = tarFile(packageTar, 'package/build/index.js');
const re2CommonJs = tarFile(packageTar, 'package/build/index.cjs');
await writeFile(join(temporaryDirectory, 're2js.mjs'), re2Bytes);
const { RE2JS } = await import(pathToFileURL(join(temporaryDirectory, 're2js.mjs')).href);

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const scheduled = new Map();
let timerId = 0;
// Timers are held so a restart can be simulated before the host's scheduled flush.
globalThis.setTimeout = (callback, delay) => { const id = ++timerId; scheduled.set(id, { callback, delay }); return id; };
globalThis.clearTimeout = id => { scheduled.delete(id); };
function backend() {
  return {
    items: new Map(), nextId: 0, failNext: false,
    async get(id) { return structuredClone(this.items.get(id) ?? null); },
    async set(id, value) { if (this.failNext) { this.failNext = false; return false; } this.items.set(id, structuredClone(value)); return true; },
    async remove(ids) { for (const id of ids) this.items.delete(id); },
    newId() { return `test-${++this.nextId}`; },
    now() { return 1000000; },
  };
}
function host(storageBackend = backend(), savedDatabase = {}) {
  const holder = { storage: structuredClone(savedDatabase) };
  const store = new PluginStorageStore(storageBackend, () => holder.storage, () => holder.storage);
  return { store, holder, backend: storageBackend };
}
try {
  await check('setItem resolves before the index is flushed', async () => {
    const h = host();
    await h.store.setItem('editor:autosave', { text: 'draft' });
    assert.equal(h.backend.items.size, 0);
    assert.equal(h.holder.storage._coldpluginIndex, undefined);
    assert([...scheduled.values()].some(item => item.delay === defaultPluginStorageOptions.flushDelay));
    return { backendWrites: 0, scheduledFlushDelayMs: defaultPluginStorageOptions.flushDelay };
  });
  await check('plugin-only reopen can read the same host store before flush', async () => {
    const h = host();
    await h.store.setItem('editor:autosave', { text: 'draft' });
    assert.deepEqual(await h.store.getItem('editor:autosave'), { text: 'draft' });
  });
  await check('host restart before flush loses an uncommitted draft', async () => {
    const h = host();
    await h.store.setItem('editor:autosave', { text: 'draft' });
    const restarted = host(h.backend, h.holder.storage);
    assert.equal(await restarted.store.getItem('editor:autosave'), null);
    return { observedLoss: true, scope: 'new host-store instance, memory backend' };
  });
  await check('flush alone does not persist an older database pointer', async () => {
    const h = host();
    const persistedDatabase = structuredClone(h.holder.storage);
    await h.store.setItem('editor:autosave', { text: 'draft' });
    await h.store.flush();
    assert(h.backend.items.size > 0);
    assert.equal(await host(h.backend, persistedDatabase).store.getItem('editor:autosave'), null);
  });
  await check('flushed storage plus a persisted pointer survives recreation', async () => {
    const h = host();
    await h.store.setItem('editor:autosave', { text: 'draft' });
    await h.store.flush();
    const restarted = host(h.backend, h.holder.storage);
    assert.deepEqual(await restarted.store.getItem('editor:autosave'), { text: 'draft' });
  });
  await check('index write failure preserves the last persisted snapshot', async () => {
    const h = host();
    await h.store.setItem('editor:autosave', { revision: 1 });
    await h.store.flush();
    const persistedDatabase = structuredClone(h.holder.storage);
    await h.store.setItem('editor:autosave', { revision: 2 });
    h.backend.failNext = true;
    await assert.rejects(h.store.flush(), /Failed to write plugin storage index/);
    assert.deepEqual(await host(h.backend, persistedDatabase).store.getItem('editor:autosave'), { revision: 1 });
  });
  await check('large value write failure preserves the earlier readable value', async () => {
    const h = host();
    await h.store.setItem('editor:manual', { revision: 1 });
    await h.store.flush();
    h.backend.failNext = true;
    await assert.rejects(h.store.setItem('editor:manual', 'x'.repeat(300000)), /Failed to write plugin storage item/);
    assert.deepEqual(await h.store.getItem('editor:manual'), { revision: 1 });
  });
  await check('automatic and manual slots and another prefix remain independent', async () => {
    const h = host();
    await h.store.setItem('risu-character-editor:v1:autosave', { revision: 1 });
    await h.store.setItem('risu-character-editor:v1:manual', { revision: 1 });
    await h.store.setItem('other-plugin:v1:autosave', { revision: 7 });
    await h.store.setItem('risu-character-editor:v1:autosave', { revision: 2 });
    await h.store.flush();
    const restarted = host(h.backend, h.holder.storage);
    assert.deepEqual(await restarted.store.getItem('risu-character-editor:v1:autosave'), { revision: 2 });
    assert.deepEqual(await restarted.store.getItem('risu-character-editor:v1:manual'), { revision: 1 });
    assert.deepEqual(await restarted.store.getItem('other-plugin:v1:autosave'), { revision: 7 });
  });
  await check('serialization failure leaves the current value unchanged', async () => {
    const h = host();
    await h.store.setItem('editor:manual', { revision: 1 });
    await assert.rejects(h.store.setItem('editor:manual', { invalid: 1n }), /BigInt/);
    assert.deepEqual(await h.store.getItem('editor:manual'), { revision: 1 });
  });
} finally {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  scheduled.clear();
}

// A deliberately limited text-only compatibility probe, not the future plugin adapter.
function replacement(pattern, flags, input, out) {
  if (pattern === '') return input; // RisuAI skips empty IN rules.
  const compiled = RE2JS.compile(RE2JS.translateRegExp(new RegExp(pattern, flags)));
  let prepared = out.replaceAll('$n', '\n').replaceAll('{{data}}', '$&');
  if (prepared.endsWith('>')) prepared += '\n'; // Basic rule without no_end_nl.
  const matcher = compiled.matcher(input);
  return flags.includes('g') ? matcher.replaceAll(prepared) : matcher.replaceFirst(prepared);
}
const fixtures = [
  ['literal-global', 'cat', 'g', 'cat cat', 'dog'],
  ['first-only', 'cat', '', 'cat cat', 'dog'],
  ['groups', '(a)(b)', 'g', 'ab ab', '$2-$1-$&-$$'],
  ['named-group', '(?<word>[a-z]+)', 'gu', 'one two', '$<word>!'],
  ['group-number-fallback', '(a)', 'g', 'a', '$10/$01/$2'],
  ['multiline', '^cat', 'gm', 'cat\ncat', 'dog'],
  ['case-insensitive', 'cat', 'gi', 'CAT cat', 'dog'],
  ['dotall', 'a.b', 'gs', 'a\nb', 'match'],
  ['zero-width', '^|$', 'g', 'ab', '|'],
  ['korean', '([가-힣]+)', 'gu', '안녕 세계', '[$1]'],
  ['emoji-unicode', '.', 'gu', '😀', 'X'],
  ['risu-newline-and-data', 'abc', 'g', 'abc', '$n{{data}}'],
  ['html-as-text', '(cat)', 'g', 'cat', '<b>$1</b>'],
  ['empty-IN', '', 'g', 'untouched', 'ignored'],
];
for (const [name, pattern, flags, input, out] of fixtures) {
  await check(`RE2JS shared subset: ${name}`, () => {
    let prepared = out.replaceAll('$n', '\n').replaceAll('{{data}}', '$&');
    if (prepared.endsWith('>')) prepared += '\n';
    const expected = pattern === '' ? input : input.replace(new RegExp(pattern, flags), prepared);
    assert.equal(replacement(pattern, flags, input, out), expected);
  });
}
await check('RE2JS rejects unsupported backreferences without native fallback', () => {
  assert.throws(() => RE2JS.compile('(a)\\1'));
});
await check('RE2JS rejects unsupported lookahead without native fallback', () => {
  assert.throws(() => RE2JS.compile('a(?=b)'));
});
await check('nested-quantifier non-match finishes in the non-backtracking engine', () => {
  const input = 'a'.repeat(65535) + '!';
  assert.equal(RE2JS.compile('(a+)+$').test(input), false);
  return { inputCodeUnits: input.length, nativeDangerousMatchNotExecuted: true };
});
await check('RE2JS runs with string code generation disabled and no Worker global', () => {
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(re2CommonJs.toString()).runInContext(context, { timeout: 2000 });
  assert.equal(vm.runInContext("module.exports.RE2JS.compile('(a+)+$').test('a'.repeat(65535)+'!')", context, { timeout: 2000 }), false);
  assert.equal(vm.runInContext("module.exports.RE2JS.compile('(cat)').matcher('cat cat').replaceAll('<b>$1</b>')", context, { timeout: 2000 }), '<b>cat</b> <b>cat</b>');
  return { stringCodeGenerationAllowed: false, WorkerGlobal: 'absent', browserCspNotExercised: true };
});

const report = {
  scope: 'RisuAI storage source with memory backend and held timers; RE2JS under Node. Not a live RisuAI/browser test.',
  nodeVersion: process.version,
  risuCommit, storageUrl, storageBlob,
  re2js: { version: re2Version, integrity, bundleSha256: createHash('sha256').update(re2Bytes).digest('hex') },
  total: checks.length,
  passed: checks.filter(item => item.passed).length,
  failed: checks.filter(item => !item.passed).length,
  checks,
  notVerified: ['Actual RisuAI UI and sandbox execution', 'Disk or account persistence and app termination', 'Actual LLM requests', 'Complete RisuAI regular-expression pipeline'],
};
await writeFile(new URL('./results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, failures: checks.filter(item => !item.passed) }, null, 2));
if (report.failed) process.exitCode = 1;
