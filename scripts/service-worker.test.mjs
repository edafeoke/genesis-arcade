import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
function harness({ failAsset = false, offline = false } = {}) {
  const handlers = {};
  const records = new Map();
  const fetches = [];
  let deleted = false;
  const cache = {
    addAll: async requests => {
      if (failAsset) throw new Error('network failure');
      for (const request of requests) records.set(request.url, new Response('asset'));
    },
    put: async (key, response) => records.set(key, response),
    match: async key => records.get(key),
  };
  const self = { location: { origin: 'https://arcade.test' }, addEventListener: (type, handler) => { handlers[type] = handler; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  class LocalRequest { constructor(url, options) { this.url = url; this.options = options; } }
  vm.runInNewContext(template.replace('__OFFLINE_VERSION__', 'test').replace('__OFFLINE_ASSETS__', JSON.stringify(['/player/index.html', '/_next/static/app.js'])), {
    self, URL, Request: LocalRequest, Response,
    caches: { open: async () => cache, delete: async () => { deleted = true; records.clear(); } },
    fetch: async (request, options) => {
      fetches.push({ request, options });
      if (offline) throw new Error('offline');
      return new Response('<html>arcade</html>', { headers: { 'content-type': 'text/html' } });
    },
  });
  return { handlers, records, fetches, get deleted() { return deleted; } };
}
async function install(h) {
  let promise;
  h.handlers.install({ waitUntil: p => { promise = p; } });
  await promise;
}
test('offline package includes HTML shell and all declared assets', async () => {
  const h = harness(); await install(h);
  assert.deepEqual([...h.records.keys()].sort(), ['/', '/_next/static/app.js', '/player/index.html']);
  assert.equal(h.fetches[0].options.headers.Accept, 'text/html');
  let reply, promise;
  h.handlers.message({ data: { type: 'STATUS' }, ports: [{ postMessage: message => { reply = message; } }], waitUntil: p => { promise = p; } });
  await promise; assert.equal(reply.ready, true);
});
test('partial package is removed when an asset fails to download', async () => {
  const h = harness({ failAsset: true });
  await assert.rejects(() => install(h), /network failure/);
  assert.equal(h.deleted, true); assert.equal(h.records.size, 0);
});
test('offline navigation restores the shell; unrelated API and POST requests are not intercepted', async () => {
  const h = harness({ offline: true }); h.records.set('/', new Response('cached arcade'));
  let response;
  h.handlers.fetch({ request: { url: 'https://arcade.test/', method: 'GET', mode: 'navigate' }, respondWith: p => { response = p; } });
  assert.equal(await (await response).text(), 'cached arcade');
  for (const [url, method] of [['https://arcade.test/api/rooms','GET'], ['https://arcade.test/','POST'], ['https://another.test/player/index.html','GET']]) {
    let intercepted = false;
    h.handlers.fetch({ request: { url, method, mode: 'cors' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
test('missing cached assets never report the package ready', async () => {
  const h = harness(); let reply, promise;
  h.handlers.message({ data: { type: 'STATUS' }, ports: [{ postMessage: message => { reply = message; } }], waitUntil: p => { promise = p; } });
  await promise; assert.equal(reply.ready, false);
});
