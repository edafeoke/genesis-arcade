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
const shell = await readFile('.next/server/app/index.html');
const assets = [...runtime.map(file => '/' + file.slice(7)), ...chunks.map(file => '/_next/' + file.slice(6)), '/favicon.ico'];
const hash = createHash('sha256').update(shell);
for (const file of [...runtime, ...chunks]) hash.update(file).update(await readFile(file));
const version = hash.digest('hex').slice(0, 16);
const template = await readFile('scripts/service-worker.js', 'utf8');
await writeFile('public/sw.js', template.replace('__OFFLINE_VERSION__', version).replace('__OFFLINE_ASSETS__', JSON.stringify(assets)));
await writeFile('public/offline-build.json', JSON.stringify({ version, assets: assets.length + 1 }));
console.log(`Offline package generated: ${version} (${assets.length + 1} resources)`);
