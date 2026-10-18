import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../public/player/capability-lab.js', import.meta.url), 'utf8');
function fixture({ search = '?lab=1', stateError = false, adapter = false, frameDiagnostic = false, drift = false, tickError = false, cpuState = false, ambiguousCpu = false, romHash } = {}) {
  let listener, frame = 12, state = 4, keyboard = 1, restores = 0, queued;
  let drifted = false, ticks = 0;
  const held = new Map();
  const replies = [];
  const parent = { postMessage: message => replies.push(message) };
  const cpuHeap = cpuState ? new Int32Array(new ArrayBuffer(1024 * 1024)) : null;
  const cpuBases = ambiguousCpu ? [64, 128] : [64];
  if (cpuHeap) cpuHeap[62] = -936;
  const manager = {
    Module: { _get_current_frame_count() {}, _unrelated() {} },
    functions: {
      setKeyboardEnabled: value => { keyboard = value; }, simulateInput(player, button, value) { held.set(`${player}:${button}`, value); },
      getFrameNum: () => frame, supportsStates: () => 1,
    },
    getState: () => {
      if (stateError) throw new Error('Serialization failed');
      if (cpuState) {
        const bytes = new Uint8Array(1036312);
        bytes.set(Buffer.from('GENESISLABFRAME1'), 32);
        const view = new DataView(bytes.buffer);
        view.setUint32(48, state, false);
        view.setUint32(144180, state, true);
        view.setUint32(144240, 0x00fffffc, true);
        view.setUint32(144244, 0x300, true);
        view.setInt32(144258, state, true);
        for (const base of cpuBases) {
          cpuHeap[base - 3] = state;
          cpuHeap[base - 1] = 896040;
          cpuHeap[base] = state;
          cpuHeap[base + 15] = 0x00fffffc;
          cpuHeap[base + 16] = 0x300;
        }
        return bytes;
      }
      return frameDiagnostic ? new Uint8Array([...Buffer.from('GENESISLABFRAME1'), 0, 0, 0, state]) : new Uint8Array([state]);
    },
    loadState: bytes => { restores++; const value = cpuState ? new DataView(bytes.buffer).getUint32(48, false) : bytes[frameDiagnostic ? 19 : 0]; if (adapter) queued = value; else state = value; },
  };
  if (cpuState) manager.Module.HEAPU8 = new Uint8Array(cpuHeap.buffer);
  if (adapter) manager.Module.genesisLabTick = () => {
    if (tickError && ++ticks === 10) throw new Error('Manual tick failed');
    frame++; state += cpuHeap && cpuHeap[62] > 100000 ? 2 : 1;
    if (cpuHeap) cpuHeap[62] = cpuHeap[62] > 100000 ? -936 : cpuHeap[62] - 1;
    if (queued !== undefined) { state = queued; queued = undefined; if (cpuHeap) cpuHeap[62] = 784000; }
    else if (drift && restores >= 2 && !drifted) { state++; drifted = true; }
  };
  const emulator = { gameManager: manager, paused: false,
    pause() { this.paused = true; }, play() { this.paused = false; frame += 15; state = 8; } };
  runInNewContext(source, { URLSearchParams, location: { search, origin: 'http://localhost' }, parent,
    window: { addEventListener: (type, callback) => { listener = callback; }, EJS_emulator: emulator, EJS_gameName: romHash ?? (cpuState ? 'c12ec5da51b65a46838808ce9a0beadc98ea8308a028197789c9354ef6134a3d' : '') },
    crypto: webcrypto, Uint8Array, Error, setTimeout: callback => callback() });
  return { replies, emulator, held, keyboard: () => keyboard, restores: () => restores,
    send: overrides => listener?.({ source: parent, origin: 'http://localhost', data: { channel: 'genesis-capability-lab-v1', type: 'probe', id: 1 }, ...overrides }) };
}
test('capability hooks are absent in the ordinary single-player frame', () => {
  const f = fixture({ search: '' });
  assert.equal(f.send(), undefined);
  assert.equal(f.replies.length, 0);
  assert.equal(f.emulator.paused, false);
});
test('probe rejects other origins and unrelated senders', async () => {
  const f = fixture();
  await f.send({ origin: 'https://untrusted.invalid' });
  await f.send({ source: {} });
  await f.send({ data: { channel: 'genesis-capability-lab-v1', type: 'probe', id: '1' } });
  assert.equal(f.replies.length, 0);
});
test('probe measures a state round trip without claiming exact stepping', async () => {
  const f = fixture();
  await f.send();
  const result = f.replies[0].result;
  assert.equal(result.pausedCounterStable, true);
  assert.equal(result.pausedSerializationStable, true);
  assert.equal(result.resumeAdvanced, true);
  assert.equal(result.immediateRestoreEqual, true);
  assert.equal(result.exactFrameStepVerified, false);
  assert.equal(f.restores(), 1);
  assert.equal(f.keyboard(), 1);
  assert.equal(f.emulator.paused, true);
});
test('failed serialization restores keyboard access and leaves the core paused', async () => {
  const f = fixture({ stateError: true });
  await f.send();
  assert.match(f.replies[0].error, /Serialization failed/);
  assert.equal(f.keyboard(), 1);
  assert.equal(f.emulator.paused, true);
});
test('instrumented probe measures queued restore and replay without certifying emulated frames', async () => {
  const f = fixture({ adapter: true });
  await f.send();
  const result = f.replies[0].result.adapter;
  assert.equal(result.counterDelta, 16);
  assert.equal(result.restoreMatchIndex, 0);
  assert.equal(result.replayEqual, true);
  assert.equal(result.stateChanged, true);
  assert.equal(result.exactEmulatedFrameVerified, false);
  assert.equal(f.emulator.paused, true);
});
test('frame fixture counter is read from serialized machine memory, independently of frontend count', async () => {
  const f = fixture({ adapter: true, frameDiagnostic: true });
  await f.send();
  const result = f.replies[0].result.adapter;
  assert.equal(result.traceGameFrames.length, 16);
  assert.equal(result.traceGameFrames[0], result.gameFrameBefore.value + 1);
  assert.equal(result.traceGameFrames[15], result.gameFrameBefore.value + 16);
  assert.deepEqual(Array.from(result.replayGameFrames), Array.from(result.traceGameFrames));
  assert.equal(result.gameFrameBefore.swapped, false);
  assert.equal(result.fixtureSingleFrameSteps, true);
});
test('120-step replay compares each state and reports no divergence for identical traces', async () => {
  const f = fixture({ adapter: true, frameDiagnostic: true });
  await f.send({ data: { channel: 'genesis-capability-lab-v1', type: 'probe', id: 1, frames: 120 } });
  const result = f.replies[0].result.adapter;
  assert.equal(result.frontendTicks, 120);
  assert.equal(result.counterDelta, 120);
  assert.equal(result.traceStepHashes.length, 120);
  assert.equal(result.replayStepHashes.length, 120);
  assert.equal(result.firstDivergentStep, null);
  assert.equal(result.replayEqual, true);
});
test('first divergent step is detected even when execution completes successfully', async () => {
  const f = fixture({ adapter: true, drift: true });
  await f.send();
  const result = f.replies[0].result.adapter;
  assert.equal(result.firstDivergentStep, 1);
  assert.equal(result.replayEqual, false);
  assert.notEqual(result.traceStepHashes[0], result.replayStepHashes[0]);
});
test('unbounded or unsupported trace lengths are rejected before entering the emulator', async () => {
  const f = fixture({ adapter: true });
  for (const frames of [0, 100000, '120', 16.5]) await f.send({ data: { channel: 'genesis-capability-lab-v1', type: 'probe', id: 1, frames } });
  assert.equal(f.replies.length, 4);
  assert.ok(f.replies.every(reply => reply.error));
  assert.equal(f.emulator.paused, false);
});
test('a failed manual tick releases injected input on both controllers', async () => {
  const f = fixture({ adapter: true, tickError: true });
  await f.send();
  assert.match(f.replies[0].error, /Manual tick failed/);
  assert.equal(f.held.get('0:4'), 0);
  assert.equal(f.held.get('1:4'), 0);
  assert.equal(f.keyboard(), 1);
  assert.equal(f.emulator.paused, true);
});
test('fixture sidecar restores omitted timing without excluding any serialized bytes', async () => {
  const f = fixture({ adapter: true, cpuState: true });
  await f.send();
  const result = f.replies[0].result.adapter;
  assert.equal(result.replayEqual, false);
  assert.equal(result.refreshSidecarReplay.available, true);
  assert.equal(result.refreshSidecarReplay.ordinaryRestoredRefreshCycles, 784000);
  assert.ok(result.refreshSidecarReplay.capturedRefreshCycles < -896);
  assert.equal(result.refreshSidecarReplay.allStepsEqual, true);
  assert.equal(result.refreshSidecarReplay.fullStateReplayEqual, true);
  assert.equal(result.refreshSidecarReplay.correctedHash, result.traceHash);
});
test('ambiguous CPU layout disables the sidecar experiment', async () => {
  const f = fixture({ adapter: true, cpuState: true, ambiguousCpu: true });
  await f.send();
  const result = f.replies[0].result.adapter;
  assert.equal(result.refreshSidecarReplay.available, false);
  assert.equal(f.restores(), 2);
});
test('the timing sidecar never runs for an unrecognized ROM hash', async () => {
  const f = fixture({ adapter: true, cpuState: true, romHash: '0'.repeat(64) });
  await f.send();
  const result = f.replies[0].result.adapter;
  assert.equal(result.cpuLayoutEvidence.checkpoint, null);
  assert.equal(result.refreshSidecarReplay.available, false);
  assert.equal(f.restores(), 2);
});
