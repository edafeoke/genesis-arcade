import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RoomStore } from './rooms';
import { CHANNEL, EMULATOR_PROFILE, schemas } from '../lib/multiplayer/protocol';
const game={name:'Demo',hash:'a'.repeat(64),profile:EMULATOR_PROFILE,multiplayerConfirmed:true};
function fixture(){
  const store=new RoomStore({streaming:true});
  const host=store.connect('h','Host').hello,guest=store.connect('g','Guest').hello;
  const {room}=store.create('h',{visibility:'public',game});store.join('g',room.code);
  store.selectGame('g',game);store.ready('h',true);store.ready('g',true);
  const viewer=store.connect('v','Viewer').hello;
  return {store,host,guest,viewer,code:room.code};
}
test('spectators join full active rooms without consuming players or resetting gameplay',()=>{
  const {store,code}=fixture();const active=store.startStream('h').room.stream!;
  const watched=store.watch('v',code);
  assert.equal(watched.players.length,2);assert.equal(watched.spectators.length,1);assert.equal(watched.stream?.epoch,active.epoch);
  assert.equal(watched.compatibility,'matched');assert.ok(watched.players.every(player=>player.ready));
  store.disconnect('v');assert.equal(store.listPublic('h').lobbies[0].spectators,1);
  assert.equal(store.stopStream('g',active.epoch),undefined);
});
test('spectators cannot ready, swap, start, stop, select games or inject player signaling',()=>{
  const {store,code}=fixture();store.watch('v',code);const active=store.startStream('h').room.stream!;
  assert.throws(()=>store.ready('v',true),/Spectators|End the game/);
  assert.throws(()=>store.selectGame('v',game),/Spectators|End the game/);
  assert.throws(()=>store.swap('v'),/Only the host|End the game/);
  assert.throws(()=>store.startStream('v'),/Only the host/);
  assert.throws(()=>store.stopStream('v',active.epoch),/Spectators/);
  assert.throws(()=>store.relayStream('v',{epoch:active.epoch,signal:{type:'answer',sdp:'v=0'}}),/Spectators/);
  assert.equal(store.relayStream('h',{epoch:active.epoch,signal:{type:'offer',sdp:'v=0'}}),'g');
});
test('spectator leave and reconnection preserve the active epoch and readiness',()=>{
  const {store,code,viewer}=fixture();store.watch('v',code);const token=viewer.token;
  const active=store.startStream('h').room.stream!;store.disconnect('v');
  const hello=store.connect('v2','Viewer',token).hello;
  assert.equal(hello.room?.stream?.epoch,active.epoch);assert.ok(hello.room?.players.every(player=>player.ready));
  store.leave('v2');assert.equal(store.listPublic('h').lobbies[0].spectators,0);
  assert.equal(store.relayStream('h',{epoch:active.epoch,signal:{type:'offer',sdp:'v=0'}}),'g');
});
test('spectator capacity and invitation validation are enforced',()=>{
  const {store,code}=fixture();assert.throws(()=>store.watch('v',code,'bad'),/invalid/);
  store.watch('v',code);
  for(let i=0;i<3;i++){store.connect(`v${i}`,`Viewer ${i}`);store.watch(`v${i}`,code);}
  store.connect('extra','Extra');assert.throws(()=>store.watch('extra',code),/four spectator/);
  assert.equal(store.listPublic('h').lobbies[0].players,2);
});
test('room peer signaling is host-directed, membership-bound, and strict about payloads',()=>{
  const {store,code,host,guest,viewer}=fixture();store.watch('v',code);
  const base={code,target:viewer.id,connection:randomUUID(),signal:{type:'offer' as const,sdp:'v=0'}};
  const relay=store.relayPeer('h',base);assert.equal(relay.socketId,'v');assert.equal(relay.message.from,host.id);
  assert.throws(()=>store.relayPeer('g',base),/host/);
  assert.throws(()=>store.relayPeer('v',{...base,target:guest.id}),/host/);
  assert.throws(()=>store.relayPeer('v',{...base,target:host.id}),/signaling role/);
  assert.throws(()=>store.relayPeer('h',{...base,code:'WRONGROOM2'}),/Wrong room/);
  assert.ok(schemas[CHANNEL.peer].safeParse(base).success);
  assert.equal(schemas[CHANNEL.peer].safeParse({...base,rom:[1,2]}).success,false);
  assert.equal(schemas[CHANNEL.peer].safeParse({...base,signal:{type:'offer',sdp:'v=0'+'x'.repeat(24000)}}).success,false);
});
