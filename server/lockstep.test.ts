import test from 'node:test';
import assert from 'node:assert/strict';
import { InputLockstep, frameInputSchema, type FrameInput } from '../lib/multiplayer/lockstep';
import type { ControllerMasks, FrameAdapter } from '../lib/emulation/adapter';

const epoch = 'd130e9b2-20ef-4f26-914c-9f008bf0097b';
function port() {
  const calls: { frame: number; inputs: ControllerMasks }[] = [];
  let releases = 0;
  const adapter: FrameAdapter = { async step(frame, inputs) { calls.push({ frame, inputs }); }, async releaseInputs() { releases++; } };
  return { adapter, calls, releases: () => releases };
}
const packet = (frame: number, buttons = 0, delay = 0): FrameInput => ({ version: 1, epoch, frame, buttons, sequence: frame - delay + 1 });

test('delay lockstep stalls on missing input and keeps controller assignments separate', async () => {
  const p = port(); const sent: FrameInput[] = [];
  const session = new InputLockstep(p.adapter, { epoch, localSlot: 2, inputDelay: 2, send: value => sent.push(value) });
  session.submitLocal(0, 16);
  assert.equal(await session.advance(4), 2);
  assert.equal(session.status.waiting, true);
  assert.deepEqual(p.calls.map(call => call.inputs), [[0, 0], [0, 0]]);
  session.receiveRemote(packet(2, 1, 2));
  assert.equal(await session.advance(), 1);
  assert.deepEqual(p.calls[2], { frame: 2, inputs: [1, 16] });
  assert.equal(sent[0].frame, 2);
});

test('out-of-order and duplicate packets never skip a frame or execute it twice', async () => {
  const p = port(), session = new InputLockstep(p.adapter, { epoch, localSlot: 1, inputDelay: 0, send() {} });
  for (let i = 0; i < 3; i++) session.submitLocal(i, 16 << i);
  session.receiveRemote(packet(2, 4)); session.receiveRemote(packet(1, 2));
  assert.equal(await session.advance(4), 0);
  assert.equal(session.receiveRemote(packet(1, 2)), 'duplicate');
  session.receiveRemote(packet(0, 1));
  assert.equal(await session.advance(4), 3);
  assert.equal(session.receiveRemote(packet(0, 1)), 'duplicate');
  assert.deepEqual(p.calls.map(call => call.inputs), [[16, 1], [32, 2], [64, 4]]);
});

test('a conflicting retransmission aborts the epoch and releases held input', async () => {
  const p = port(), session = new InputLockstep(p.adapter, { epoch, localSlot: 1, inputDelay: 0, send() {} });
  session.receiveRemote(packet(0, 1));
  assert.throws(() => session.receiveRemote(packet(0, 2)), /Conflicting/);
  await session.stop();
  assert.equal(p.releases(), 1);
  assert.equal(await session.advance(), 0);
  assert.equal(session.status.remoteBuffered, 0);
});

test('malformed, future, wrong-sequence and slot-forging packets cannot change input buffers', () => {
  const p = port(), session = new InputLockstep(p.adapter, { epoch, localSlot: 1, inputDelay: 0, maxAhead: 4, send() {} });
  for (const value of [{ ...packet(0), slot: 1 }, { ...packet(0), buttons: 65536 }, packet(5), { ...packet(0), sequence: 2 }]) {
    assert.throws(() => session.receiveRemote(value));
  }
  assert.equal(session.status.remoteBuffered, 0);
  assert.equal(session.receiveRemote({ ...packet(0), epoch: 'e130e9b2-20ef-4f26-914c-9f008bf0097b' }), 'stale');
  assert.equal(frameInputSchema.safeParse({ ...packet(0), rom: new Uint8Array([1]) }).success, false);
});

test('disconnect during an awaited step stops further frames and releases once', async () => {
  const p = port(); let finish!: () => void;
  p.adapter.step = () => new Promise<void>(resolve => { finish = resolve; });
  const session = new InputLockstep(p.adapter, { epoch, localSlot: 1, inputDelay: 0, send() {} });
  session.submitLocal(0, 1); session.receiveRemote(packet(0, 16));
  const first = session.advance(), second = session.advance();
  assert.equal(first, second);
  await session.stop('Opponent disconnected.');
  finish(); assert.equal(await first, 0);
  assert.throws(() => session.submitLocal(1, 0), /disconnected/);
  assert.equal(p.releases(), 1);
});

test('two peers execute identical 300-frame traces despite reordering, jitter and duplicates', async () => {
  const a = port(), b = port(); const toA: FrameInput[] = [], toB: FrameInput[] = [];
  const first = new InputLockstep(a.adapter, { epoch, localSlot: 1, inputDelay: 3, maxAhead: 24, send: value => toB.push(value) });
  const second = new InputLockstep(b.adapter, { epoch, localSlot: 2, inputDelay: 3, maxAhead: 24, send: value => toA.push(value) });
  for (let base = 0; base < 300; base += 10) {
    for (let i = base; i < base + 10; i++) { first.submitLocal(i, (i * 17) & 0xffff); second.submitLocal(i, (i * 31) & 0xffff); }
    // Deterministic jitter batches and reversed delivery; inject exact duplicates.
    for (const value of toA.splice(0).reverse()) { first.receiveRemote(value); first.receiveRemote(value); }
    await first.advance(24);
    for (const value of toB.splice(0).reverse()) { second.receiveRemote(value); second.receiveRemote(value); }
    await second.advance(24);
  }
  assert.equal(a.calls.length, 303);
  assert.deepEqual(a.calls, b.calls);
  assert.ok(first.status.remoteBuffered <= 25);
  assert.ok(second.status.localBuffered <= 25);
});
test('an empty stop reason cannot leave an epoch running', async () => {
  const p = port(), session = new InputLockstep(p.adapter, { epoch, localSlot: 1, inputDelay: 0, send() {} });
  await session.stop('');
  assert.equal(await session.advance(), 0);
  assert.throws(() => session.submitLocal(0, 0), /stopped/);
  assert.equal(p.releases(), 1);
});
