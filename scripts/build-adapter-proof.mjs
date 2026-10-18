import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Use tsx's pinned esbuild dependency, avoiding a second bundler installation.
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
const output = 'public/sync-lab/runtime/adapter-proof.js';
await esbuild.build({ entryPoints: ['lab/adapter-proof.ts'], outfile: output, bundle: true, platform: 'browser', target: 'es2022' });
const provenancePath = 'public/sync-lab/runtime/provenance.json';
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
provenance.adapterProofSHA256 = createHash('sha256').update(await readFile(output)).digest('hex');
await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
const htmlPath = 'public/sync-lab/runtime/player.html';
const html = await readFile(htmlPath, 'utf8');
await writeFile(htmlPath, html.replace('</head>', '<script src="/sync-lab/runtime/adapter-proof.js" defer></script>\n</head>'));
