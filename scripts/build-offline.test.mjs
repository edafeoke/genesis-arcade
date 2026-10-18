import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./build-offline.mjs', import.meta.url));
const template = await readFile(new URL('./service-worker.js', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'arcade-offline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'public/player/index.html': '<html>player</html>',
    'public/emulator/core.wasm': 'core',
    '.next/static/chunks/app.js': 'client',
    '.next/BUILD_ID': 'build-one',
    'app/favicon.ico': 'icon',
    'scripts/service-worker.js': template,
  };
  for (const [file, data] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), data);
  }
  const run = async () => {
    await exec(process.execPath, [script], { cwd: root });
    return JSON.parse(await readFile(path.join(root, 'public/offline-build.json'), 'utf8'));
  };
  return { root, run };
}

test('offline package builds without private server HTML and includes runtime assets', async t => {
  const { root, run } = await fixture(t);
  const result = await run();
  assert.equal(result.assets, 5);
  const worker = await readFile(path.join(root, 'public/sw.js'), 'utf8');
  assert.ok(worker.includes('/_next/static/chunks/app.js'));
  assert.ok(worker.includes('/emulator/core.wasm'));
  assert.ok(worker.includes(result.version));
  assert.ok(!worker.includes('__OFFLINE_'));
});

test('new builds and worker/runtime changes invalidate the offline package', async t => {
  const { root, run } = await fixture(t);
  let previous = (await run()).version;
  for (const [file, data] of [
    ['.next/BUILD_ID', 'build-two'],
    ['scripts/service-worker.js', Buffer.concat([template, Buffer.from('\n// changed')])],
    ['public/emulator/core.wasm', 'updated core'],
    ['.next/static/chunks/app.js', 'updated client'],
    ['app/favicon.ico', 'updated icon'],
  ]) {
    await writeFile(path.join(root, file), data);
    const next = (await run()).version;
    assert.notEqual(next, previous, file);
    previous = next;
  }
});

test('missing build identity fails instead of publishing an incomplete package', async t => {
  const { root, run } = await fixture(t);
  await rm(path.join(root, '.next/BUILD_ID'));
  await assert.rejects(run, /BUILD_ID/);
  await assert.rejects(readFile(path.join(root, 'public/sw.js')), { code: 'ENOENT' });
});
