import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../public/online-player/session.js', import.meta.url), 'utf8');
function fixture(hostSlot = 1) {
  const handlers = new Map(), inputs = new Map(), sent = [], replies = [];
  let now = 10000, frame = 42, watchdog, poll, paused = false, peer, changeDevice;
  const device = { value: 'keyboard', addEventListener(name, handler) { if (name === 'change') changeDevice = handler; } };
  const parent = { postMessage: message => replies.push(message) };
  const data = { label: 'genesis-controller-v1', readyState: 'open', bufferedAmount: 0, send: value => sent.push(JSON.parse(value)), close() { this.readyState = 'closed'; } };
  class AudioNode { connect() {} }
  class Peer {
    constructor() { peer = true; }
    addTrack() {} close() {} createDataChannel() { return data; }
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async setLocalDescription(value) { this.localDescription = value; }
  }
  const manager = { functions: { simulateInput: (port, button, value) => inputs.set(`${port}:${button}`, value), setKeyboardEnabled() {}, getFrameNum: () => frame }, simulateInput() {} };
  const window = { addEventListener: (name, fn) => handlers.set(name, fn), EJS_emulator: { gameManager: manager, pause() { paused = true; }, play() { paused = false; } } };
  const element = { textContent: '', srcObject: null, hidden: false, addEventListener() {}, async play() {} };
  const document = { hidden: false, hasFocus: () => true, addEventListener() {}, querySelectorAll: () => [], querySelector: selector => selector === '#input-device' ? device : selector === '#game canvas' ? { captureStream: () => ({ getTracks: () => [], getAudioTracks: () => [] }) } : element };
  runInNewContext(source, { window, parent, document, location: { origin: 'http://arcade.test' }, AudioNode, RTCPeerConnection: Peer, HTMLInputElement: class {}, HTMLSelectElement: class {}, navigator: { getGamepads: () => [] }, performance: { now: () => now }, Date: { now: () => now }, setInterval: (fn, ms) => { if (ms === 100) watchdog = fn; else poll = fn; return 1; }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, Map, JSON, Number, Object, Array, Math });
  const message = (value, origin = 'http://arcade.test', sender = parent) => handlers.get('message')({ source: sender, origin, data: { channel: 'genesis-stream-v1', ...value } });
  const epoch = '102c2437-ecb8-4dd5-b369-40f33d821e39';
  return { inputs, sent, replies, data, epoch, manager, paused: () => paused, peer: () => peer,
    async start() { message({ type: 'init', config: { epoch, host: true, hostSlot, iceServers: [] } }); await handlers.get('genesis-started')(); data.onopen(); },
    packet: packet => data.onmessage({ data: JSON.stringify({ epoch, sequence: 1, buttons: 16, sent: now, ...packet }) }),
    remap(keys) { window.GenesisControls = {keys}; },
    key(type, code) { handlers.get(type)({ code, target: {}, preventDefault() {}, stopImmediatePropagation() {} }); poll(); },
    blur() { handlers.get('blur')(); },
    device(value) { device.value = value; changeDevice(); },
    frame() { frame++; poll(); },
    advance(ms) { now += ms; watchdog(); }, message,
  };
}
test('streamed input owns only the remote controller and acknowledges the host frame', async () => {
  const f = fixture(); await f.start();
  f.key('keydown', 'KeyA'); assert.equal(f.inputs.get('0:1'), 1);
  f.packet({}); assert.equal(f.inputs.get('1:4'), 1); assert.equal(f.inputs.get('0:1'), 1);
  assert.equal(f.sent.at(-1).frame, 42);
  f.packet({ sequence: 1, buttons: 0 }); assert.equal(f.inputs.get('1:4'), 1);
  f.packet({ sequence: 2, buttons: 0 }); f.frame(); assert.equal(f.inputs.get('1:4'), 0);
  f.key('keyup', 'KeyA'); f.frame(); assert.equal(f.inputs.get('0:1'), 0);
});
test('a short tap is held through one core frame while blur bypasses that latch', async () => {
  const f = fixture(); await f.start();
  f.key('keydown', 'KeyS'); f.key('keyup', 'KeyS');
  assert.equal(f.inputs.get('0:0'), 1);
  f.frame(); assert.equal(f.inputs.get('0:0'), 0);
  f.packet({}); f.packet({ sequence: 2, buttons: 0 });
  assert.equal(f.inputs.get('1:4'), 1);
  f.frame(); assert.equal(f.inputs.get('1:4'), 0);
  f.key('keydown', 'KeyS'); f.blur(); assert.equal(f.inputs.get('0:0'), 0);
});
test('swapped slots stay isolated, lost heartbeats release held input, blur releases local input', async () => {
  const f = fixture(2); await f.start();
  f.packet({}); assert.equal(f.inputs.get('0:4'), 1);
  f.key('keydown', 'ArrowRight'); assert.equal(f.inputs.get('1:7'), 1);
  f.blur(); assert.equal(f.inputs.get('1:7'), 0);
  f.key('keydown', 'ArrowRight'); assert.equal(f.inputs.get('1:7'), 1);
  f.advance(800); assert.equal(f.inputs.get('0:4'), 0); assert.equal(f.inputs.get('1:7'), 1);
  f.packet({ sequence: 2, buttons: 16 });
  f.advance(5001); assert.ok([...f.inputs.values()].every(value => value === 0)); assert.ok(f.paused());
});
test('stale epochs cannot inject input; slot forgery and oversized packets stop and release the session', async () => {
  const f = fixture(); await f.start();
  f.packet({ epoch: 'old' }); assert.equal(f.inputs.get('1:4'), 0);
  f.packet({}); f.packet({ sequence: 2, slot: 1 });
  assert.ok([...f.inputs.values()].every(value => value === 0)); assert.ok(f.paused());
  const g = fixture(); await g.start(); g.data.onmessage({ data: 'x'.repeat(257) }); assert.ok(g.paused());
});
test('only the same-origin parent can initialize the streaming bridge', () => {
  const f = fixture();
  const payload = { type: 'init', config: { epoch: f.epoch, host: true, hostSlot: 1, iceServers: [] } };
  f.message(payload, 'https://other.test'); assert.equal(f.peer(), undefined);
  f.message(payload, 'http://arcade.test', {}); assert.equal(f.peer(), undefined);
});
test('explicit shared-keyboard mode owns both local ports and remote heartbeats cannot overwrite player two', async () => {
  const f = fixture(); await f.start(); f.device('shared');
  f.key('keydown', 'KeyK'); f.key('keydown', 'KeyG');
  assert.equal(f.inputs.get('0:0'), 1); assert.equal(f.inputs.get('1:0'), 1);
  f.packet({ buttons: 0 }); assert.equal(f.inputs.get('1:0'), 1);
  f.blur(); assert.ok([...f.inputs.values()].every(value => value === 0));
  f.device('keyboard'); f.packet({ sequence: 2 }); assert.equal(f.inputs.get('1:4'), 1);
  const swapped = fixture(2); await swapped.start(); swapped.device('shared');
  swapped.key('keydown', 'KeyK'); swapped.key('keydown', 'KeyG');
  assert.equal(swapped.inputs.get('0:0'), 1); assert.equal(swapped.inputs.get('1:0'), 1);
});

test('custom online keyboard mappings replace default keys and preserve controller isolation', async () => {
  const f=fixture(); await f.start(); f.remap({KeyZ:0,Enter:3});
  f.key('keydown','KeyS'); assert.equal(f.inputs.get('0:0'),0);
  f.key('keydown','KeyZ'); assert.equal(f.inputs.get('0:0'),1);
  f.packet({buttons:16}); assert.equal(f.inputs.get('1:4'),1);
  f.blur(); assert.equal(f.inputs.get('0:0'),0);
});
