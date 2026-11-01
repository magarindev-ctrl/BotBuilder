import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await mkdir('dist', { recursive: true });
const notices = await readFile('THIRD_PARTY_NOTICES.txt', 'utf8');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const { VERSION } = await import('../src/core.js');
if (version !== VERSION) throw new Error('Package and runtime version differ');
const header = `//@name risu_story_workshop\n//@display-name 봇빌더\n//@api 3.0\n//@version ${version}\n//@update-url https://raw.githubusercontent.com/magarindev-ctrl/BotBuilder/main/dist/risu_story_workshop.js\n`;
const result = await build({ entryPoints: ['src/main.js'], outfile: 'dist/risu_story_workshop.js', bundle: true, format: 'iife', target: ['es2022'], platform: 'browser', legalComments: 'inline', banner: { js: header + '\n/*\n' + notices.replaceAll('*/', '* /') + '\n*/' }, minify: false, metafile: true });
const bytes = await readFile('dist/risu_story_workshop.js');
if (Object.values(result.metafile.outputs).some(output => output.imports.length)) throw new Error('Unexpected external code dependency');
if (!bytes.includes('/*__DA_WORKSHOP_INTEROP__*/')) throw new Error('DA Interop marker missing from bundle; Dusk Atelier detects the integration by it');
// Runtime CSP execution is checked separately; RE2JS has a harmless method named eval.
console.log(`Built dist/risu_story_workshop.js (${bytes.length.toLocaleString()} bytes, SHA-256 ${createHash('sha256').update(bytes).digest('hex')})`);
