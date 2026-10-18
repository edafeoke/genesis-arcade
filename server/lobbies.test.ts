import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CHANNEL, EMULATOR_PROFILE, LOBBY_PAGE_SIZE, schemas, type GameMetadata } from '../lib/multiplayer/protocol';
import { RoomError, RoomStore } from './rooms';

const game = (name='Sonic test'): GameMetadata => ({name,hash:'a'.repeat(64),profile:EMULATOR_PROFILE,multiplayerConfirmed:true});
const fails = (run:()=>unknown, code:string) => assert.throws(run,error=>error instanceof RoomError && error.code===code);
function setup() {
  let now=0;
  const store=new RoomStore({now:()=>now,graceMs:100,idleMs:1000});
  store.connect('host','Public host');store.connect('private','Private identity');store.connect('visitor','Visitor');
  const privateRoom=store.create('private');
  const created=store.create('host',{visibility:'public',game:game()});
  return {store,created,privateRoom,advance:(value:number)=>{now=value;}};
}
test('public discovery excludes private rooms and every credential/identity/hash field',()=>{
  const {store,created,privateRoom}=setup();const result=store.listPublic('visitor');
  assert.equal(result.total,1);const lobby=result.lobbies[0];
  assert.deepEqual(Object.keys(lobby).sort(),['id','gameName','players','readyPlayers','capacity','status','modeConfirmed','expiresAt'].sort());
  assert.equal(lobby.status,'waiting');assert.equal(lobby.players,1);
  const serialized=JSON.stringify(result);
  for(const value of [created.room.code,created.inviteToken,privateRoom.room.code,privateRoom.inviteToken,'Private identity','Public host','a'.repeat(64),EMULATOR_PROFILE]) assert.ok(!serialized.includes(value));
  fails(()=>store.joinPublic('visitor',privateRoom.room.code),'ROOM_UNAVAILABLE');
  fails(()=>store.joinPublic('visitor',randomUUID()),'ROOM_UNAVAILABLE');
});
test('public joins enforce capacity, reservation, readiness and host presence',()=>{
  const {store}=setup();const id=store.listPublic('visitor').lobbies[0].id;
  assert.equal(store.joinPublic('visitor',id).visibility,'public');
  store.selectGame('visitor',game());store.ready('host',true);store.ready('visitor',true);
  let lobby=store.listPublic('private').lobbies[0];assert.equal(lobby.status,'full');assert.equal(lobby.readyPlayers,2);
  store.connect('third','Third');fails(()=>store.joinPublic('third',id),'ROOM_FULL');
  store.disconnect('visitor');lobby=store.listPublic('third').lobbies[0];assert.equal(lobby.players,2);assert.equal(lobby.readyPlayers,0);
  fails(()=>store.joinPublic('third',id),'ROOM_FULL');
  store.disconnect('host');assert.equal(store.listPublic('third').lobbies[0].status,'host-away');
  fails(()=>store.joinPublic('third',id),'HOST_AWAY');
});
test('leaving reopens a room; game changes affect search; cleared games and expired rooms are unavailable',()=>{
  const {store,advance}=setup();const id=store.listPublic('visitor').lobbies[0].id;
  store.joinPublic('visitor',id);store.leave('visitor');assert.equal(store.listPublic('visitor').lobbies[0].status,'waiting');
  store.selectGame('host',game('Streets of Test'));assert.equal(store.listPublic('visitor','SONIC').total,0);assert.equal(store.listPublic('visitor','streets').total,1);
  store.selectGame('host',null);assert.equal(store.listPublic('visitor').total,0);fails(()=>store.joinPublic('visitor',id),'ROOM_UNAVAILABLE');
  store.selectGame('host',game());advance(1001);assert.equal(store.listPublic('visitor').total,0);fails(()=>store.joinPublic('visitor',id),'ROOM_UNAVAILABLE');
});
test('host disconnect expiry and explicit closure remove discovery records',()=>{
  const {store,advance}=setup();const id=store.listPublic('visitor').lobbies[0].id;
  store.disconnect('host');advance(101);assert.equal(store.listPublic('visitor').total,0);fails(()=>store.joinPublic('visitor',id),'ROOM_UNAVAILABLE');
  store.connect('newhost','Host');store.create('newhost',{visibility:'public',game:game()});assert.equal(store.listPublic('visitor').total,1);store.leave('newhost');assert.equal(store.listPublic('visitor').total,0);
});
test('discovery is bounded and paginated; create/list/join payloads are strict',()=>{
  const store=new RoomStore();store.connect('visitor','Visitor');
  for(let i=0;i<LOBBY_PAGE_SIZE+3;i++){const socket=`h${i}`;store.connect(socket,'Host');store.create(socket,{visibility:'public',game:game()});}
  const first=store.listPublic('visitor');const second=store.listPublic('visitor','',LOBBY_PAGE_SIZE);
  assert.equal(first.total,53);assert.equal(first.lobbies.length,50);assert.equal(second.lobbies.length,3);
  assert.equal(new Set([...first.lobbies,...second.lobbies].map(lobby=>lobby.id)).size,53);
  assert.equal(schemas[CHANNEL.create].safeParse({visibility:'public'}).success,false);
  assert.equal(schemas[CHANNEL.create].safeParse({visibility:'private',game:game()}).success,false);
  assert.equal(schemas[CHANNEL.create].safeParse({visibility:'public',game:game(),rom:[1]}).success,false);
  assert.equal(schemas[CHANNEL.list].safeParse({offset:501}).success,false);
  assert.equal(schemas[CHANNEL.list].safeParse({query:'x'.repeat(81)}).success,false);
  assert.equal(schemas[CHANNEL.list].safeParse({includePrivate:true}).success,false);
  assert.equal(schemas[CHANNEL.joinPublic].safeParse({id:'not-a-uuid'}).success,false);
  fails(()=>store.listPublic('outsider'),'SESSION');
});
