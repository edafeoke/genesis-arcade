import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, EMULATOR_PROFILE, authSchema, codeSchema, schemas, type GameMetadata } from '../lib/multiplayer/protocol';
import { RoomError, RoomStore } from './rooms';
import { RateLimiter } from './app';

const game = (hash = 'a'.repeat(64), profile = EMULATOR_PROFILE, multiplayerConfirmed = true): GameMetadata => ({ name: 'Original diagnostic', hash, profile, multiplayerConfirmed });
const throwsCode = (action: () => unknown, code: string) => assert.throws(action, error => error instanceof RoomError && error.code === code);
function pair() {
  const store = new RoomStore();
  const host = store.connect('host', 'Host').hello;
  const guest = store.connect('guest', 'Guest').hello;
  const created = store.create('host'); store.join('guest', created.room.code, created.inviteToken);
  return { store, host, guest, ...created };
}

test('room codes and secrets are secure-shaped; member snapshots exclude credentials', () => {
  const { room, host, inviteToken } = pair();
  assert.equal(codeSchema.safeParse(room.code).success, true);
  assert.equal(inviteToken.length, 43); assert.equal(host.token.length, 43);
  assert.ok(!JSON.stringify(room).includes(host.token)); assert.ok(!JSON.stringify(room).includes(inviteToken));
});
test('membership, invitation tokens, capacity and host authority are enforced', () => {
  const { store, room } = pair(); store.connect('outsider', 'Guest');
  throwsCode(() => store.selectGame('outsider', game()), 'MEMBERSHIP');
  throwsCode(() => store.start('guest'), 'HOST_ONLY');
  throwsCode(() => store.swap('guest'), 'HOST_ONLY');
  throwsCode(() => store.join('outsider', room.code, 'x'.repeat(43)), 'ROOM_UNAVAILABLE');
  throwsCode(() => store.join('outsider', room.code, 'é'.repeat(43)), 'ROOM_UNAVAILABLE');
  throwsCode(() => store.join('outsider', room.code), 'ROOM_FULL');
  throwsCode(() => store.create('host'), 'ALREADY_IN_ROOM');
});
test('matching filenames do not satisfy readiness; matching ROMs and profiles are required', () => {
  const { store } = pair();
  store.selectGame('host', game());
  assert.equal(store.selectGame('guest', game('b'.repeat(64))).compatibility, 'rom-mismatch');
  throwsCode(() => store.ready('host', true), 'NOT_COMPATIBLE');
  assert.equal(store.selectGame('guest', game('a'.repeat(64), 'another-core')).compatibility, 'profile-mismatch');
  throwsCode(() => store.ready('guest', true), 'NOT_COMPATIBLE');
  store.selectGame('guest', game('a'.repeat(64), EMULATOR_PROFILE, false));
  throwsCode(() => store.ready('guest', true), 'NOT_COMPATIBLE');
});
test('game, controller and connection changes clear readiness; gameplay is explicitly gated', () => {
  const { store } = pair();
  store.selectGame('host', game()); store.selectGame('guest', game());
  store.ready('host', true); const ready = store.ready('guest', true);
  assert.ok(ready.players.every(player => player.ready));
  throwsCode(() => store.start('host'), 'SYNC_UNAVAILABLE');
  const swapped = store.swap('host'); assert.ok(swapped.players.every(player => !player.ready));
  assert.equal(swapped.players.find(player => player.name === 'Host')?.slot, 2);
  throwsCode(() => store.start('host'), 'NOT_READY');
  store.ready('host', true); store.ready('guest', true);
  const changed = store.selectGame('host', game()); assert.ok(changed.players.every(player => !player.ready));
});
test('reconnect credentials restore a reserved slot and stale sockets cannot mutate it', () => {
  const { store, guest, room } = pair();
  store.selectGame('host', game()); store.selectGame('guest', game());
  store.ready('host', true); store.ready('guest', true); store.disconnect('guest');
  store.connect('third', 'Third'); throwsCode(() => store.join('third', room.code), 'ROOM_FULL');
  throwsCode(() => store.ready('host', true), 'NOT_COMPATIBLE');
  const resumed = store.connect('resumed', 'Guest', guest.token).hello;
  assert.equal(resumed.restored, true); assert.equal(resumed.id, guest.id);
  assert.equal(resumed.room?.players.find(player => player.id === guest.id)?.slot, 2);
  assert.ok(resumed.room?.players.every(player => !player.ready));
  store.disconnect('guest'); throwsCode(() => store.selectGame('guest', game()), 'SESSION');
  assert.equal(store.selectGame('resumed', game()).players.find(player => player.id === guest.id)?.connected, true);
});
test('guest expiry frees a slot; host expiry closes the room and invalidates old membership', () => {
  let now = 0;
  const store = new RoomStore({ now: () => now, graceMs: 100, idleMs: 10000 });
  store.connect('host', 'Host'); const guest = store.connect('guest', 'Guest').hello;
  const { room } = store.create('host'); store.join('guest', room.code); store.disconnect('guest');
  now = 101; store.sweep();
  assert.equal(store.connect('newguest', 'Guest', guest.token).hello.restored, false);
  store.join('newguest', room.code); store.disconnect('host');
  now = 202; store.sweep();
  throwsCode(() => store.selectGame('newguest', game()), 'MEMBERSHIP');
  throwsCode(() => store.join('newguest', room.code), 'ROOM_UNAVAILABLE');
});
test('idle and maximum lifetimes expire even when a host remains connected', () => {
  let now = 0;
  const store = new RoomStore({ now: () => now, idleMs: 100, lifetimeMs: 150 });
  store.connect('host', 'Host'); store.create('host'); now = 101; store.sweep();
  throwsCode(() => store.selectGame('host', game()), 'MEMBERSHIP');
  store.create('host'); now = 180; store.selectGame('host', game()); now = 252; store.sweep();
  throwsCode(() => store.selectGame('host', game()), 'MEMBERSHIP');
});
test('host departure closes both memberships; a guest can leave without closing the host room', () => {
  const { store, room } = pair(); store.leave('guest');
  store.join('guest', room.code); store.leave('host');
  throwsCode(() => store.ready('guest', true), 'MEMBERSHIP');
  throwsCode(() => store.join('guest', room.code), 'ROOM_UNAVAILABLE');
});
test('protocol rejects ROM data, binary messages, oversized names and malformed secrets', () => {
  assert.equal(schemas[CHANNEL.game].safeParse({game:game(),rom: new Uint8Array(10)}).success, false);
  assert.equal(schemas[CHANNEL.create].safeParse(new Uint8Array(10)).success, false);
  assert.equal(authSchema.safeParse({name:'x'.repeat(25)}).success, false);
  assert.equal(authSchema.safeParse({name:'Guest', token:'fake'}).success, false);
  assert.equal(schemas[CHANNEL.ready].safeParse({ready:'true'}).success, false);
});
test('rate windows reset and room/session capacity stays bounded', () => {
  let now = 0; const limiter = new RateLimiter(() => now);
  assert.equal(limiter.allow('ip',2,100), true); assert.equal(limiter.allow('ip',2,100), true); assert.equal(limiter.allow('ip',2,100), false);
  now = 100; assert.equal(limiter.allow('ip',2,100), true);
  const store = new RoomStore({maxRooms:1,maxSessions:2});
  store.connect('a','A'); store.connect('b','B'); store.create('a');
  throwsCode(() => store.create('b'), 'CAPACITY'); throwsCode(() => store.connect('c','C'), 'CAPACITY');
});
