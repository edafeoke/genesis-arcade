import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createMultiplayerServer } from './app';
import { CHANNEL, EMULATOR_PROFILE, type Reply, type RoomSnapshot, type SessionHello } from '../lib/multiplayer/protocol';

async function setup(t: TestContext) {
  const service = createMultiplayerServer({ origins:['http://arcade.test'] });
  service.http.listen(0, '127.0.0.1'); await once(service.http, 'listening');
  t.after(() => service.close());
  const url = `http://127.0.0.1:${(service.http.address() as AddressInfo).port}`;
  const connect = (token?: string, origin = 'http://arcade.test') => new Promise<{ client: Socket; session: SessionHello }>((resolve,reject) => {
    const client = io(url, {autoConnect:false, transports:['websocket'], reconnection:false, extraHeaders:{Origin:origin}, auth:{name:'Guest', ...(token ? {token}: {})}});
    t.after(() => {client.disconnect();});
    const timeout = setTimeout(() => {client.disconnect(); reject(new Error('Connection timed out'));},3000);
    client.once('session', (session: SessionHello) => {clearTimeout(timeout);resolve({client,session});});
    client.once('connect_error', error => {clearTimeout(timeout);client.disconnect();reject(error);});
    client.connect();
  });
  return {service,url,connect};
}
const send = (client: Socket,event:string,data:object = {}) => new Promise<Reply>((resolve,reject) => client.timeout(2000).emit(event,data,(error:Error|null,result:Reply) => error ? reject(error) : resolve(result)));
const roomOf = (reply: Reply): RoomSnapshot => {assert.ok(reply.ok && reply.room);return reply.room;};

test('real Socket.IO clients join, match ROMs, ready up, swap slots and leave; start is gated', async t => {
  const {connect,url} = await setup(t);
  const {client:host} = await connect(); const {client:guest} = await connect();
  const created = await send(host,CHANNEL.create); const room = roomOf(created);
  assert.ok(created.ok && created.inviteToken);
  assert.equal((await send(guest,CHANNEL.join,{code:room.code,inviteToken:'x'.repeat(43)})).ok,false);
  assert.equal(roomOf(await send(guest,CHANNEL.join,{code:room.code,inviteToken:created.inviteToken})).players.length,2);
  const metadata = {name:'Original diagnostic', hash:'a'.repeat(64),profile:EMULATOR_PROFILE,multiplayerConfirmed:true};
  await send(host,CHANNEL.game,{game:metadata}); await send(guest,CHANNEL.game,{game:metadata});
  await send(host,CHANNEL.ready,{ready:true});
  assert.ok(roomOf(await send(guest,CHANNEL.ready,{ready:true})).players.every(player => player.ready));
  const start = await send(host,CHANNEL.start);assert.ok(!start.ok && start.code==='SYNC_UNAVAILABLE');
  const forbidden = await send(guest,CHANNEL.swap);assert.ok(!forbidden.ok && forbidden.code==='HOST_ONLY');
  assert.ok(roomOf(await send(host,CHANNEL.swap)).players.every(player => !player.ready));
  await send(guest,CHANNEL.leave); assert.equal((await send(guest,CHANNEL.game,{game:metadata})).ok,false);
  const health = await fetch(url+'/health');assert.equal((await health.json()).syncAvailable,false);
  assert.equal((await fetch(url+'/rooms')).status,404);
});
test('origin validation rejects websocket clients and malformed/prototype event names cannot crash the service', async t => {
  const {connect} = await setup(t);
  await assert.rejects(() => connect(undefined,'https://evil.test'));
  const {client} = await connect();
  for (const event of ['toString','__proto__','unknown:event']) {
    const reply = await send(client,event);assert.ok(!reply.ok && reply.code==='INVALID_MESSAGE');
  }
  const rom = await send(client,CHANNEL.create,{rom:[1,2,3]});assert.ok(!rom.ok && rom.code==='INVALID_MESSAGE');
  assert.ok((await send(client,CHANNEL.create)).ok);
});
test('disconnect/reconnect preserves slot with a secret, not a chosen display name', async t => {
  const {connect} = await setup(t);
  const {client:host} = await connect(); const {client:guest,session} = await connect();
  const room = roomOf(await send(host,CHANNEL.create));await send(guest,CHANNEL.join,{code:room.code});
  const update = new Promise<RoomSnapshot>(resolve => {host.on('room:update',snapshot => {if(snapshot.players.some((p:{connected:boolean}) => !p.connected)) resolve(snapshot);});});
  guest.disconnect();assert.ok((await update).players.some(player => !player.connected));
  const {client:outsider} = await connect();
  const full = await send(outsider,CHANNEL.join,{code:room.code});assert.ok(!full.ok && full.code==='ROOM_FULL');
  const resumed = await connect(session.token);assert.equal(resumed.session.id,session.id);assert.equal(resumed.session.room?.code,room.code);
  assert.equal(resumed.session.room?.players.find(player => player.id===session.id)?.slot,2);
});
test('creation rate limits are enforced across rooms and oversized packets disconnect', async t => {
  const {connect} = await setup(t);const {client} = await connect();
  for(let count=0;count<3;count++){assert.ok((await send(client,CHANNEL.create)).ok);await send(client,CHANNEL.leave);}
  const limited = await send(client,CHANNEL.create);assert.ok(!limited.ok && limited.code==='RATE_LIMIT');
  const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()));client.emit(CHANNEL.create,{rom:'x'.repeat(5000)});await disconnected;
  assert.equal(client.connected,false);
});

test('public discovery and joins work over sockets without exposing private room data',async t=>{
  const {connect}=await setup(t);const {client:host}=await connect();const {client:privateHost}=await connect();const {client:browser}=await connect();const {client:other}=await connect();
  const hidden=await send(privateHost,CHANNEL.create);const privateRoom=roomOf(hidden);
  const metadata={name:'Public diagnostic fixture',hash:'a'.repeat(64),profile:EMULATOR_PROFILE,multiplayerConfirmed:false};
  const created=await send(host,CHANNEL.create,{visibility:'public',game:metadata});const publicRoom=roomOf(created);
  assert.equal(publicRoom.visibility,'public');
  const page=await send(browser,CHANNEL.list,{query:'diagnostic'});assert.ok(page.ok && page.lobbies && page.total===1);
  assert.ok(!JSON.stringify(page).includes(privateRoom.code));assert.ok(!JSON.stringify(page).includes(publicRoom.code));
  assert.ok(hidden.ok && !JSON.stringify(page).includes(hidden.inviteToken!));
  assert.ok(created.ok && !JSON.stringify(page).includes(created.inviteToken!));assert.ok(!JSON.stringify(page).includes(metadata.hash));
  const id=page.lobbies[0].id;assert.equal(page.lobbies[0].modeConfirmed,false);
  assert.equal(roomOf(await send(browser,CHANNEL.joinPublic,{id})).code,publicRoom.code);
  const full=await send(other,CHANNEL.joinPublic,{id});assert.ok(!full.ok && full.code==='ROOM_FULL');
  const fullPage=await send(other,CHANNEL.list,{});assert.ok(fullPage.ok && fullPage.lobbies?.[0].status==='full');
  await send(host,CHANNEL.leave);
  const gone=await send(other,CHANNEL.list,{});assert.ok(gone.ok && gone.total===0);
  const expired=await send(other,CHANNEL.joinPublic,{id});assert.ok(!expired.ok && expired.code==='ROOM_UNAVAILABLE');
});

test('public discovery has its own read quota and rejects invalid pagination',async t=>{
  const {connect}=await setup(t);const {client}=await connect();
  const invalid=await send(client,CHANNEL.list,{offset:501});assert.ok(!invalid.ok && invalid.code==='INVALID_MESSAGE');
  for(let i=0;i<30;i++) assert.ok((await send(client,CHANNEL.list,{})).ok);
  const limited=await send(client,CHANNEL.list,{});assert.ok(!limited.ok && limited.code==='RATE_LIMIT');
  assert.equal(client.connected,true);
});
