import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_FIXTURE_SHA256, FixtureEmulatorBackend, type FixtureManager } from '../lib/emulation/fixture-backend';
import { ADAPTER_VERSION, VersionedEmulatorAdapter } from '../lib/emulation/adapter';

function fixture() {
  let frame = 0, queued: Uint8Array | undefined, advance = 1, loadWorks = true;
  const heap = new Int32Array(1024);
  heap[62] = -936;
  const inputs = new Map<string, number>();
  const manager: FixtureManager = {
    Module: { HEAPU8: new Uint8Array(heap.buffer), async genesisLabTick() {
      if (queued && loadWorks) { frame = new DataView(queued.buffer).getUint32(48); queued = undefined; heap[62] = 784000; }
      else { frame += advance; heap[62]++; }
    } },
    functions: { simulateInput(player, button, value) { inputs.set(`${player}:${button}`, value); } },
    getState() {
      const bytes = new Uint8Array(1036312), view = new DataView(bytes.buffer);
      bytes.set(new TextEncoder().encode('GENESISLABFRAME1'), 32);
      view.setUint32(48, frame);
      view.setUint32(144180, frame, true);
      view.setUint32(144240, 0x00fffffc, true);
      view.setUint32(144244, 0x300, true);
      view.setInt32(144258, frame, true);
      heap[61] = frame; heap[63] = 896040;
      for (let index = 0; index < 17; index++) heap[64 + index] = view.getInt32(144180 + index * 4, true);
      return bytes;
    },
    loadState(bytes) { queued = bytes; },
  };
  return { manager, heap, inputs, setAdvance(value: number) { advance = value; }, failLoad() { loadWorks = false; } };
}

test('native fixture backend completes queued restore and restores omitted timing through versioned adapter', async () => {
  const f = fixture(), backend = new FixtureEmulatorBackend(f.manager, FRAME_FIXTURE_SHA256);
  const adapter = new VersionedEmulatorAdapter({ adapter: ADAPTER_VERSION, rom: FRAME_FIXTURE_SHA256, core: 'a'.repeat(64), runtime: 'b'.repeat(64), settings: 'c'.repeat(64) }, backend, { allowFixtureOnly: true });
  const start = await adapter.capture();
  await adapter.step(0, [16, 2]);
  assert.equal(f.inputs.get('0:4'), 1); assert.equal(f.inputs.get('1:1'), 1);
  const end = await adapter.capture();
  await adapter.restore(start);
  assert.equal(f.heap[62], -936);
  assert.ok([...f.inputs.values()].every(value => value === 0));
  await adapter.step(0, [16, 2]);
  assert.deepEqual(await adapter.capture(), end);
});

test('wrong ROM, ambiguous live CPU, invalid timing and failed queued loads are refused', async () => {
  const f = fixture();
  assert.throws(() => new FixtureEmulatorBackend(f.manager, 'a'.repeat(64)), /exact diagnostic/);
  const backend = new FixtureEmulatorBackend(f.manager, FRAME_FIXTURE_SHA256);
  const state = await backend.capture();
  await assert.rejects(backend.restore({ ...state, auxiliary: { refresh_cycles: Infinity } }), /Invalid/);
  await assert.rejects(backend.restore({ ...state, auxiliary: { refresh_cycles: 0, extra: 1 } }), /Invalid/);
  f.heap.set(f.heap.slice(61, 81), 125);
  assert.throws(() => new FixtureEmulatorBackend(f.manager, FRAME_FIXTURE_SHA256), /ambiguous/);
  f.heap.fill(0, 125, 145);
  f.failLoad();
  await assert.rejects(backend.restore(state), /complete checkpoint/);
});

test('measured counter rejects skipped frames and all held buttons can be released', async () => {
  const f = fixture(), backend = new FixtureEmulatorBackend(f.manager, FRAME_FIXTURE_SHA256);
  f.setAdvance(2);
  await assert.rejects(backend.step([0xffff, 0xffff]), /exactly one/);
  await backend.releaseInputs();
  assert.equal(f.inputs.size, 32);
  assert.ok([...f.inputs.values()].every(value => value === 0));
});
