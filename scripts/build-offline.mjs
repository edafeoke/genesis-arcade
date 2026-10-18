import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : path.join(directory, entry.name)));
  return nested.flat().sort();
}
const runtime = [...await walk('public/player'), ...await walk('public/emulator')];
const chunks = (await walk('.next/static')).filter(file => !file.endsWith('.map'));
// Platform adapters may relocate prerendered HTML before this script runs.
// The worker fetches the shell during installation; BUILD_ID versions that shell
// without depending on Next's private server output layout.
const buildId = await readFile('.next/BUILD_ID', 'utf8');
if (!buildId.trim()) throw new Error('Missing Next.js build identity');
const template = await readFile('scripts/service-worker.js', 'utf8');
const assets = [...runtime.map(file => '/' + file.slice(7)), ...chunks.map(file => '/_next/' + file.slice(6)), '/favicon.ico'];
const hash = createHash('sha256').update(buildId).update(template);
for (const file of [...runtime, ...chunks, 'app/favicon.ico']) hash.update(file).update(await readFile(file));
const version = hash.digest('hex').slice(0, 16);
await writeFile('public/sw.js', template.replace('__OFFLINE_VERSION__', version).replace('__OFFLINE_ASSETS__', JSON.stringify(assets)));
await writeFile('public/offline-build.json', JSON.stringify({ version, assets: assets.length + 1 }));
console.log(`Offline package generated: ${version} (${assets.length + 1} resources)`);
