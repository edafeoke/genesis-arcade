import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_VERSION, VersionedEmulatorAdapter, type AdapterIdentity, type EmulatorBackend, type ControllerMasks } from '../lib/emulation/adapter';
import { InputLockstep, type FrameInput } from '../lib/multiplayer/lockstep';

const identity: AdapterIdentity = { adapter: ADAPTER_VERSION, rom: 'a'.repeat(64), core: 'b'.repeat(64), runtime: 'c'.repeat(64), settings: 'd'.repeat(64) };
function backend() {
  let value = 0, refresh = -936, releases = 0, restores = 0;
  const port: EmulatorBackend = {
    capabilities: { verification: 'verified', singleVideoFrame: true, completeState: true },
    async step(inputs) { value += 1 + inputs[0] * 3 + inputs[1] * 7 + Math.abs(refresh) % 3; refresh++; return 1; },
    async capture() { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return { bytes, auxiliary: { refresh_cycles: refresh } }; },
    async restore(state) { restores++; value = new DataView(state.bytes.buffer, state.bytes.byteOffset).getUint32(0); refresh = state.auxiliary.refresh_cycles; },
    async releaseInputs() { releases++; },
  };
  return { port, releases: () => releases, restores: () => restores };
}

test('versioned snapshots preserve core bytes and auxiliary timing across a full replay', async () => {
  const b = backend(), adapter = new VersionedEmulatorAdapter(identity, b.port);
  const checkpoint = await adapter.capture();
  const trace: ControllerMasks[] = [[1, 0], [0, 16], [256, 2], [0, 0]];
  for (let frame = 0; frame < trace.length; frame++) await adapter.step(frame, trace[frame]);
  const expected = await adapter.capture();
  await adapter.restore(checkpoint);
  for (let frame = 0; frame < trace.length; frame++) await adapter.step(frame, trace[frame]);
  assert.deepEqual(await adapter.capture(), expected);
  assert.equal(checkpoint.auxiliary.refresh_cycles, -936);
});

test('tampered core bytes or auxiliary timing fail before touching the backend', async () => {
  const b = backend(), adapter = new VersionedEmulatorAdapter(identity, b.port);
  const snapshot = await adapter.capture();
  await assert.rejects(adapter.restore({ ...snapshot, auxiliary: { refresh_cycles: 784000 } }), /checksum/);
  snapshot.bytes[0] ^= 1;
  await assert.rejects(adapter.restore(snapshot), /checksum/);
  assert.equal(b.restores(), 0);
  assert.equal(b.releases(), 0);
});

test('each ROM, core, runtime and settings mismatch blocks restoration', async () => {
  const b = backend(), adapter = new VersionedEmulatorAdapter(identity, b.port);
  const snapshot = await adapter.capture();
  for (const key of ['rom', 'core', 'runtime', 'settings'] as const) {
    await assert.rejects(adapter.restore({ ...snapshot, identity: { ...identity, [key]: 'e'.repeat(64) } }), /differ/);
  }
  assert.equal(b.restores(), 0);
});

test('state operations and input release wait until a pending native step finishes', async () => {
  const b = backend();
  let finish!: () => void;
  const events: string[] = [];
  b.port.step = async () => { events.push('step'); await new Promise<void>(resolve => { finish = resolve; }); events.push('done'); return 1; };
  b.port.capture = async () => { events.push('capture'); return { bytes: new Uint8Array([1]), auxiliary: {} }; };
  b.port.releaseInputs = async () => { events.push('release'); };
  const adapter = new VersionedEmulatorAdapter(identity, b.port);
  const step = adapter.step(0, [0, 0]), captured = adapter.capture(), released = adapter.releaseInputs();
  await Promise.resolve();
  assert.deepEqual(events, ['step']);
  finish(); await Promise.all([step, captured, released]);
  assert.deepEqual(events, ['step', 'done', 'capture', 'release']);
});

test('unexpected frame advancement faults the adapter and releases held input', async () => {
  const b = backend(); b.port.step = async () => 2;
  const adapter = new VersionedEmulatorAdapter(identity, b.port);
  await assert.rejects(adapter.step(0, [1, 16]), /exactly one/);
  await assert.rejects(adapter.capture(), /fresh instance/);
  assert.equal(b.releases(), 1);
});

test('unverified capabilities are refused and fixture-only use requires explicit opt-in', () => {
  const b = backend(); b.port.capabilities.verification = 'unverified';
  assert.throws(() => new VersionedEmulatorAdapter(identity, b.port, { allowFixtureOnly: true }), /verification/);
  b.port.capabilities.verification = 'fixture-only';
  assert.throws(() => new VersionedEmulatorAdapter(identity, b.port), /verification/);
  assert.doesNotThrow(() => new VersionedEmulatorAdapter(identity, b.port, { allowFixtureOnly: true }));
  b.port.capabilities.completeState = false;
  assert.throws(() => new VersionedEmulatorAdapter(identity, b.port, { allowFixtureOnly: true }), /verification/);
});
test('two lockstep-driven model backends reach identical full snapshots after jittered delivery', async () => {
  const firstBackend = backend(), secondBackend = backend();
  firstBackend.port.capabilities.verification = 'fixture-only';
  secondBackend.port.capabilities.verification = 'fixture-only';
  const firstAdapter = new VersionedEmulatorAdapter(identity, firstBackend.port, { allowFixtureOnly: true });
  const secondAdapter = new VersionedEmulatorAdapter(identity, secondBackend.port, { allowFixtureOnly: true });
  const toFirst: FrameInput[] = [], toSecond: FrameInput[] = [];
  const epoch = 'd130e9b2-20ef-4f26-914c-9f008bf0097b';
  const first = new InputLockstep(firstAdapter, { epoch, localSlot: 1, inputDelay: 2, send: packet => toSecond.push(packet) });
  const second = new InputLockstep(secondAdapter, { epoch, localSlot: 2, inputDelay: 2, send: packet => toFirst.push(packet) });
  for (let base = 0; base < 300; base += 10) {
    for (let i = base; i < base + 10; i++) { first.submitLocal(i, (i * 17) & 0xffff); second.submitLocal(i, (i * 31) & 0xffff); }
    for (const packet of toFirst.splice(0).reverse()) { first.receiveRemote(packet); first.receiveRemote(packet); }
    for (const packet of toSecond.splice(0).reverse()) { second.receiveRemote(packet); second.receiveRemote(packet); }
    await Promise.all([first.advance(32), second.advance(32)]);
    assert.deepEqual(await firstAdapter.capture(), await secondAdapter.capture());
  }
  assert.equal(first.status.frame, 302);
});
