import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createMultiplayerServer } from './app';
import { RoomStore } from './rooms';
import { CHANNEL, EMULATOR_PROFILE, type Reply, type SessionHello, type StreamSignal } from '../lib/multiplayer/protocol';
const game = { name: 'Two-controller diagnostic', hash: 'a'.repeat(64), profile: EMULATOR_PROFILE, multiplayerConfirmed: true };
const request = (socket: Socket, event: string, data: object = {}) => new Promise<Reply>((resolve, reject) => socket.timeout(2000).emit(event, data, (error: Error | null, reply: Reply) => error ? reject(error) : resolve(reply)));

test('active session pings maintain idle activity without bypassing maximum lifetime', () => {
  let now = 0;
  const store = new RoomStore({ streaming: true, now: () => now, idleMs: 1000, lifetimeMs: 3000 });
  store.connect('h', 'Host'); store.connect('g', 'Guest');
  const created = store.create('h'); store.join('g', created.room.code);
  store.selectGame('h', game); store.selectGame('g', game); store.ready('h', true); store.ready('g', true);
  store.startStream('h');
  for (now = 500; now < 3000; now += 500) store.pingStream('h');
  let closed = false; store.onClosed = () => { closed = true; };
  store.pingStream('h'); assert.equal(closed, true);
  assert.throws(() => store.startStream('h'), /Join a room/);
});

test('host streaming requires membership, matching ready ROMs, host authority and a fresh epoch', () => {
  const store = new RoomStore({ streaming: true });
  store.connect('host', 'Host'); store.connect('guest', 'Guest'); store.connect('other', 'Other');
  const created = store.create('host'); store.join('guest', created.room.code);
  assert.throws(() => store.startStream('guest'), /Only the host/);
  assert.throws(() => store.startStream('host'), /ready/);
  store.selectGame('host', game); store.selectGame('guest', game);
  store.ready('host', true); store.ready('guest', true);
  const active = store.startStream('host').room;
  assert.ok(active.streamAvailable && active.stream);
  assert.equal(active.syncAvailable, false);
  assert.equal(active.stream.hostSlot, 1);
  const offer: StreamSignal = { epoch: active.stream.epoch, signal: { type: 'offer', sdp: 'v=0\r\n' } };
  assert.equal(store.relayStream('host', offer), 'guest');
  assert.throws(() => store.relayStream('other', offer), /Join a room/);
  assert.throws(() => store.relayStream('guest', offer), /signaling role/);
  assert.throws(() => store.relayStream('host', { ...offer, epoch: '00000000-0000-4000-8000-000000000000' }), /ended/);
  assert.throws(() => store.swap('host'), /End the game/);
  assert.throws(() => store.selectGame('guest', game), /End the game/);
  store.stopStream('guest', active.stream.epoch);
  assert.throws(() => store.relayStream('host', offer), /ended/);
  assert.throws(() => store.startStream('host'), /ready/);
  store.swap('host'); store.ready('host', true); store.ready('guest', true);
  const swapped = store.startStream('host').room.stream!;
  assert.equal(swapped.hostSlot, 2); assert.notEqual(swapped.epoch, active.stream.epoch);
  let stopped = false;
  store.onUpdate = room => { stopped = room.stream === null && room.players.every(player => !player.ready); };
  store.disconnect('guest'); assert.ok(stopped);
});

test('real sockets relay only active-room signaling; normal start remains gated and ROM payloads are refused', async t => {
  const service = createMultiplayerServer({ origins: ['http://arcade.test'], store: new RoomStore({ streaming: true }) });
  service.http.listen(0, '127.0.0.1'); await once(service.http, 'listening');
  t.after(() => service.close());
  const url = `http://127.0.0.1:${(service.http.address() as AddressInfo).port}`;
  async function connect() {
    const socket = io(url, { transports: ['websocket'], extraHeaders: { Origin: 'http://arcade.test' }, auth: { name: 'Guest' }, autoConnect: false, reconnection: false });
    t.after(() => { socket.disconnect(); });
    const hello = new Promise<SessionHello>((resolve, reject) => { socket.once('session', resolve); socket.once('connect_error', reject); });
    socket.connect(); await hello; return socket;
  }
  const host = await connect(), guest = await connect(), outsider = await connect();
  const create = await request(host, CHANNEL.create); assert.ok(create.ok && create.room);
  await request(guest, CHANNEL.join, { code: create.room.code });
  await request(host, CHANNEL.game, { game }); await request(guest, CHANNEL.game, { game });
  await request(host, CHANNEL.ready, { ready: true }); await request(guest, CHANNEL.ready, { ready: true });
  const gated = await request(host, CHANNEL.start); assert.ok(!gated.ok && gated.code === 'SYNC_UNAVAILABLE');
  const start = await request(host, CHANNEL.streamStart); assert.ok(start.ok && start.room?.stream);
  const signal: StreamSignal = { epoch: start.room.stream.epoch, signal: { type: 'offer', sdp: 'v=0\r\n' + 'a=test\r\n'.repeat(600) } };
  const received = new Promise<StreamSignal>(resolve => guest.once(CHANNEL.signal, resolve));
  assert.ok((await request(host, CHANNEL.signal, signal)).ok);
  assert.deepEqual(await received, signal);
  assert.equal((await request(outsider, CHANNEL.signal, signal)).ok, false);
  assert.equal((await request(guest, CHANNEL.signal, signal)).ok, false);
  assert.equal((await request(host, CHANNEL.signal, { ...signal, rom: [1, 2, 3] })).ok, false);
  assert.equal((await request(host, CHANNEL.signal, { ...signal, signal: { type: 'offer', sdp: 'ROM bytes' } })).ok, false);
  assert.ok((await request(guest, CHANNEL.streamStop, { epoch: signal.epoch })).ok);
  assert.equal((await request(host, CHANNEL.signal, signal)).ok, false);
});
