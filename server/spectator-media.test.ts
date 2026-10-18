import test from 'node:test';
import assert from 'node:assert/strict';
import { SpectatorMediaSender, EarlyRoomCandidates } from '../lib/multiplayer/spectator-media';

function fixture(){
  const slots:{kind:string;direction:string;sender:{track:MediaStreamTrack|null;replaceTrack:(track:MediaStreamTrack|null)=>Promise<void>}}[]=[];
  const pc={addTransceiver(kind:string,options:{direction:string}){
    const sender={track:null as MediaStreamTrack|null,async replaceTrack(track:MediaStreamTrack|null){this.track=track;}};
    slots.push({kind,direction:options.direction,sender});return {sender};
  }} as unknown as RTCPeerConnection;
  const sender=new SpectatorMediaSender(pc);
  const track=(kind:string,id:string,readyState='live')=>({kind,id,readyState}) as MediaStreamTrack;
  const stream=(...tracks:MediaStreamTrack[])=>({getTracks:()=>tracks}) as MediaStream;
  return {sender,slots,track,stream};
}
test('spectator media slots exist before the first offer, including when gameplay has not started',async()=>{
  const f=fixture();
  assert.deepEqual(f.slots.map(({kind,direction})=>({kind,direction})),[{kind:'video',direction:'sendonly'},{kind:'audio',direction:'sendonly'}]);
  await f.sender.sync(null);assert.ok(f.slots.every(slot=>slot.sender.track===null));
  const video=f.track('video','v'),audio=f.track('audio','a');
  await f.sender.sync(f.stream(video,audio));
  assert.equal(f.slots[0].sender.track,video);assert.equal(f.slots[1].sender.track,audio);
  assert.equal(f.slots.length,2,'starting after a data-only room connection must not add more transceivers');
});
test('late viewers and restarted games attach current tracks and release previous video/audio',async()=>{
  const f=fixture(),first=f.track('video','first'),audio=f.track('audio','audio');
  await f.sender.sync(f.stream(first,audio));await f.sender.sync(null);
  assert.ok(f.slots.every(slot=>slot.sender.track===null));
  const second=f.track('video','second');
  await f.sender.sync(f.stream(second,f.track('audio','ended-audio','ended')));
  assert.equal(f.slots[0].sender.track,second);assert.equal(f.slots[1].sender.track,null);
  assert.equal(f.slots.length,2);
});
test('rapid media changes serialize and leave the last requested game attached',async()=>{
  const f=fixture(),first=f.track('video','first'),second=f.track('video','second');
  await Promise.all([f.sender.sync(f.stream(first)),f.sender.sync(null),f.sender.sync(f.stream(second))]);
  assert.equal(f.slots[0].sender.track,second);
});
test('early trickle ICE survives offer ordering and remains bounded per connection',()=>{
  const buffer=new EarlyRoomCandidates();
  const candidate={candidate:'candidate:early',sdpMid:'0',sdpMLineIndex:0};
  buffer.add('new-peer',candidate);assert.deepEqual(buffer.take('new-peer'),[candidate]);assert.deepEqual(buffer.take('new-peer'),[]);
  for(let i=0;i<101;i++)buffer.add('bounded',candidate);
  assert.equal(buffer.take('bounded').length,100);
  for(let i=0;i<5;i++)buffer.add(`peer-${i}`,candidate);
  assert.deepEqual(buffer.take('peer-0'),[]);assert.equal(buffer.take('peer-4').length,1);
});
