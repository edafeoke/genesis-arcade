'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { CHANNEL, type Reply, type RoomSnapshot, type RoomPeerSignal } from '@/lib/multiplayer/protocol';
import { SpectatorMediaSender, EarlyRoomCandidates } from '@/lib/multiplayer/spectator-media';
import { iceServers } from '@/lib/multiplayer/ice';
import { validRomOffer, verifySharedRom, type RomOffer } from '@/lib/multiplayer/rom-transfer';
import { importGame, type Game } from '@/lib/library';

type Offer = RomOffer;
type Peer = { id:string; connection:string; pc:RTCPeerConnection; channel?:RTCDataChannel; candidates:RTCIceCandidateInit[]; tail:Promise<void>; incoming?:{offer:Offer;chunks:ArrayBuffer[];received:number}; offered?:Offer; busy?:boolean; viewer:boolean; mediaSender?:SpectatorMediaSender };
const uuid=(v:unknown):v is string=>typeof v==='string' && /^[a-f0-9-]{36}$/.test(v);

export default function RoomPeers({room,myId,client,games,media,onLibraryChange}: {room:RoomSnapshot;myId:string;client:Socket;games:Game[];media:MediaStream|null;onLibraryChange:()=>Promise<void>}) {
  const peers=useRef(new Map<string,Peer>()), video=useRef<HTMLVideoElement>(null);
  const [message,setMessage]=useState('Connecting direct room peers…'), [offer,setOffer]=useState<Offer|null>(null), [busy,setBusy]=useState(false), [online,setOnline]=useState<string[]>([]), [sound,setSound]=useState(false);
  const [receiving,setReceiving]=useState(false);
  const [picture,setPicture]=useState(false), [audio,setAudio]=useState(false);
  const latest=useRef({room,games,media});
  const refreshLibrary=useEffectEvent(onLibraryChange);
  const host=room.hostId===myId, spectator=room.spectators.some(member=>member.id===myId);
  const selected=games.find(game=>game.id===room.players.find(player=>player.id===room.hostId)?.game?.hash);
  const remotePlayer=room.players.find(player=>player.id!==room.hostId);
  const controls=useRef<{sync:()=>void;accept:()=>void;decline:()=>void;retry:()=>void;offer:()=>Promise<void>}|null>(null);
  const streamEpoch=room.stream?.epoch;
  useEffect(()=>{
    if(!spectator || !streamEpoch || picture)return;
    const timer=setTimeout(()=>setMessage('No live picture received. Retry the spectator connection. If it still fails on another network, a TURN relay may be required.'),25_000);
    return ()=>clearTimeout(timer);
  },[spectator,streamEpoch,picture]);
  useEffect(()=>{latest.current={room,games,media};controls.current?.sync();},[room,games,media]);
  useEffect(()=>{
    let disposed=false;
    const peerMap=peers.current, videoElement=video.current;
    const earlyCandidates = new EarlyRoomCandidates();
    const update=()=>{if(!disposed)setOnline([...peers.current.values()].filter(peer=>peer.channel?.readyState==='open').map(peer=>peer.id));};
    const show=(text:string)=>{if(!disposed)setMessage(text);};
    const send=(peer:Peer, value:object)=>{if(peer.channel?.readyState==='open')peer.channel.send(JSON.stringify(value));};
    const signal=(peer:Peer,value:RoomPeerSignal['signal'])=>{
      if(disposed || peers.current.get(peer.id)!==peer || peer.pc.signalingState==='closed')return;
      client.timeout(5000).emit(CHANNEL.peer,{code:room.code,target:peer.id,connection:peer.connection,signal:value},(error:Error|null,reply:Reply)=>{if(error || !reply?.ok)show('Direct peer signaling failed. Rejoin the room to retry.');});
    };
    function drop(peer:Peer){if(!host && spectator && peers.current.get(peer.id)===peer){if(videoElement)videoElement.srcObject=null;setPicture(false);setAudio(false);setSound(false);}peer.channel?.close();peer.pc.close();if(peers.current.get(peer.id)===peer)peers.current.delete(peer.id);update();}
    function attach(peer:Peer,channel:RTCDataChannel){
      if(channel.label!=='genesis-room-v1' || peer.channel){channel.close();return;}
      peer.channel=channel;channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=64*1024;
      channel.onopen=()=>{if(disposed || peers.current.get(peer.id)!==peer)return;update();show(peer.viewer?(videoElement && videoElement.readyState>=2?'Watching live. Spectators cannot send controller input.':'Connected to host. Waiting for live picture and sound…'):'Direct game sharing available.');};
      channel.onclose=()=>{if(disposed || peers.current.get(peer.id)!==peer)return;update();if(!host){peer.incoming=undefined;peer.offered=undefined;setOffer(null);setReceiving(false);show('Direct room connection closed. Leave and rejoin to retry.');}};
      channel.onerror=()=>show('Direct room connection failed. Some networks require TURN.');
      channel.onmessage=event=>{
        try {
          if(event.data instanceof ArrayBuffer){
            if(host || !peer.incoming || !event.data.byteLength || event.data.byteLength>16384)throw new Error('Unexpected ROM chunk.');
            const transfer=peer.incoming;
            if(transfer.received+event.data.byteLength>transfer.offer.size)throw new Error('ROM exceeds the offered size.');
            transfer.chunks.push(event.data);transfer.received+=event.data.byteLength;
            show(`Receiving game… ${Math.floor(100*transfer.received/transfer.offer.size)}%`);return;
          }
          if(typeof event.data!=='string' || event.data.length>2048)throw new Error('Invalid peer message.');
          const value=JSON.parse(event.data);
          if(value.type==='offer'){
            if(host || spectator || peer.incoming || !validRomOffer(value,latest.current.room.players.find(player=>player.id===room.hostId)?.game?.hash))throw new Error('Invalid game offer.');
            peer.offered=value;setOffer(value);show('The host offered a game. Accept to store it in your library.');
          } else if(value.type==='accept'){
            if(!host || peer.viewer || !peer.offered || value.id!==peer.offered.id || peer.busy)return;
            void transmit(peer).catch(()=>{peer.offered=undefined;peer.busy=false;setBusy(false);show('Transfer failed. Offer the game again to retry.');send(peer,{type:'cancel'});});
          } else if(value.type==='decline'){
            if(!host || value.id!==peer.offered?.id)return;
            peer.offered=undefined;show('The other player declined the game.');
          } else if(value.type==='end'){
            if(host || !peer.incoming || value.id!==peer.incoming.offer.id)throw new Error('Unexpected transfer end.');
            const transfer=peer.incoming;peer.incoming=undefined;
            if(transfer.received!==transfer.offer.size)throw new Error('Incomplete ROM transfer.');
            void (async()=>{
              const bytes=await verifySharedRom(transfer.chunks,transfer.offer);
              if(disposed || peer.channel?.readyState!=='open')throw new Error('The transfer connection ended. Retry in the room.');
              await importGame(new File([bytes],transfer.offer.name));await refreshLibrary();
              if(!disposed){setOffer(null);show('Game verified and added to your library. Select it in the waiting room.');send(peer,{type:'received',id:transfer.offer.id});}
            })().catch(error=>show(error.message)).finally(()=>{if(!disposed)setReceiving(false);});
          } else if(value.type==='received'){
            if(host && value.id===peer.offered?.id){peer.offered=undefined;show('The other player verified and stored the game.');}
          } else if(value.type==='cancel'){
            peer.incoming=undefined;peer.offered=undefined;if(!host){setOffer(null);setReceiving(false);}show('Game transfer cancelled.');
          } else throw new Error('Unknown peer message.');
        }catch(error){show(error instanceof Error?error.message:'Invalid room peer message.');drop(peer);}
      };
    }
    async function transmit(peer:Peer){
      const offered=peer.offered,game=latest.current.games.find(game=>game.id===offered?.hash);
      if(!offered || !game)throw new Error('The offered ROM is unavailable.');
      peer.busy=true;setBusy(true);
      const bytes=await game.rom.arrayBuffer(),channel=peer.channel!;
      for(let offset=0;offset<bytes.byteLength;offset+=16384){
        if(disposed || channel.readyState!=='open')throw new Error('Peer disconnected.');
        if(channel.bufferedAmount>256*1024)await new Promise<void>((resolve,reject)=>{
          const finish=()=>{clearTimeout(timer);channel.removeEventListener('bufferedamountlow',low);channel.removeEventListener('close',closed);};
          const low=()=>{finish();resolve();},closed=()=>{finish();reject(new Error('Peer disconnected.'));};
          const timer=setTimeout(()=>{finish();reject(new Error('Transfer stalled.'));},15_000);
          channel.addEventListener('bufferedamountlow',low);channel.addEventListener('close',closed);
        });
        channel.send(bytes.slice(offset,offset+16384));
        show(`Sending game… ${Math.min(100,Math.floor(100*(offset+16384)/bytes.byteLength))}%`);
      }
      send(peer,{type:'end',id:offered.id});peer.busy=false;setBusy(false);show('Game sent. Waiting for hash verification…');
    }
    function create(id:string,connection:string,viewer:boolean){
      const pc=new RTCPeerConnection({iceServers:iceServers(),bundlePolicy:'max-bundle'});
      const peer:Peer={id,connection,pc,candidates:earlyCandidates.take(connection),tail:Promise.resolve(),viewer};
      if(host && viewer)peer.mediaSender=new SpectatorMediaSender(pc);peers.current.set(id,peer);
      pc.onicecandidate=event=>{if(event.candidate)signal(peer,{type:'candidate',candidate:event.candidate.candidate,sdpMid:event.candidate.sdpMid,sdpMLineIndex:event.candidate.sdpMLineIndex});};
      pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed'){show('Direct room connection failed. Some networks require TURN.');drop(peer);}};
      pc.ondatachannel=event=>attach(peer,event.channel);
      pc.ontrack=event=>{
        if(host || !spectator || !videoElement || disposed || peers.current.get(peer.id)!==peer)return;
        let stream=videoElement.srcObject as MediaStream|null;
        if(!stream){stream=new MediaStream();videoElement.srcObject=stream;}
        for(const previous of stream.getTracks())if(previous.kind===event.track.kind)stream.removeTrack(previous);
        stream.addTrack(event.track);
        const check=()=>{
          if(disposed || peers.current.get(peer.id)!==peer)return;
          const hasAudio=stream.getAudioTracks().some(track=>track.readyState==='live' && !track.muted);
          setAudio(hasAudio);
          if(!stream.getVideoTracks().some(track=>track.readyState==='live' && !track.muted)){setPicture(false);show('Connected to host. Waiting for live picture…');}
          else videoElement.play().catch(()=>show('Playback paused. Select Enable sound to resume.'));
        };
        event.track.onunmute=check;event.track.onmute=check;event.track.onended=check;check();
      };
      if(host){
        pc.onnegotiationneeded=()=>{peer.tail=peer.tail.then(async()=>{if(disposed || pc.signalingState!=='stable')return;await pc.setLocalDescription(await pc.createOffer());signal(peer,{type:'offer',sdp:pc.localDescription!.sdp});}).catch(()=>show('Could not negotiate the room peer.'));};
        attach(peer,pc.createDataChannel('genesis-room-v1',{ordered:true}));
      }
      return peer;
    }
    const listener=(value:RoomPeerSignal)=>{
      if(disposed || value.code!==room.code || value.target!==myId || !uuid(value.connection))return;
      if(!host && value.from!==room.hostId)return;
      if(value.signal.type==='hello'){if(host){const member=[...latest.current.room.players,...latest.current.room.spectators].find(member=>member.id===value.from && member.connected);if(member){const previous=peers.current.get(value.from);if(previous)drop(previous);create(value.from,crypto.randomUUID(),latest.current.room.spectators.some(viewer=>viewer.id===value.from));sync();}}return;}
      let peer=peers.current.get(value.from);
      if(!peer || peer.connection!==value.connection){
        if(!host && value.signal.type==='candidate'){const {type,...candidate}=value.signal;void type;earlyCandidates.add(value.connection,candidate);return;}
        if(host || value.signal.type!=='offer')return;
        if(peer)drop(peer);peer=create(value.from,value.connection,spectator);
      }
      const current=peer;
      current.tail=current.tail.then(async()=>{
        if(disposed || peers.current.get(current.id)!==current)return;
        if(value.signal.type==='candidate'){
          const {type,...candidate}=value.signal;void type;
          if(!current.pc.remoteDescription){if(current.candidates.length>=100)throw new Error('Too many ICE candidates.');current.candidates.push(candidate);}else await current.pc.addIceCandidate(candidate);return;
        }
        if(value.signal.type==='hello')return;
        await current.pc.setRemoteDescription(value.signal);
        for(const candidate of current.candidates.splice(0))await current.pc.addIceCandidate(candidate);
        if(!host){await current.pc.setLocalDescription(await current.pc.createAnswer());signal(current,{type:'answer',sdp:current.pc.localDescription!.sdp});}
      }).catch(()=>show('Could not establish the direct room connection. Rejoin to retry.'));
    };
    function sync(){
      if(!host)return;
      const current=latest.current, members=[...current.room.players,...current.room.spectators].filter(member=>member.id!==myId && member.connected);
      for(const peer of peers.current.values())if(!members.some(member=>member.id===peer.id))drop(peer);
      for(const member of members){
        let peer=peers.current.get(member.id);
        const viewer=current.room.spectators.some(viewer=>viewer.id===member.id);
        if(!peer)peer=create(member.id,crypto.randomUUID(),viewer);
        if(viewer && peer.mediaSender){
          const currentPeer=peer;
          void peer.mediaSender.sync(current.media).catch(()=>{
            if(!disposed && peers.current.get(currentPeer.id)===currentPeer)show('Could not attach spectator picture/audio. End the game and start it again.');
          });
        }
      }
    }
    controls.current={sync,retry:()=>{
      if(host)return;
      const peer=peers.current.get(room.hostId);if(peer)drop(peer);
      show('Retrying the spectator connection…');
      client.timeout(5000).emit(CHANNEL.peer,{code:room.code,target:room.hostId,connection:crypto.randomUUID(),signal:{type:'hello'}},(error:Error|null,reply:Reply)=>{if(error || !reply?.ok)show('Could not reconnect to the host. Leave and rejoin the room.');});
    },accept:()=>{const peer=peers.current.get(room.hostId);if(!peer?.offered || peer.incoming)return;peer.incoming={offer:peer.offered,chunks:[],received:0};setReceiving(true);send(peer,{type:'accept',id:peer.offered.id});},decline:()=>{const peer=peers.current.get(room.hostId);if(peer?.offered){send(peer,{type:'decline',id:peer.offered.id});peer.offered=undefined;}setOffer(null);},offer:async()=>{
      const current=latest.current,game=current.games.find(game=>game.id===current.room.players.find(player=>player.id===room.hostId)?.game?.hash);
      const guest=current.room.players.find(player=>player.id!==room.hostId),peer=guest && peers.current.get(guest.id);
      if(!game || !peer || peer.viewer || peer.channel?.readyState!=='open')throw new Error('Wait for the other player’s direct connection.');
      if(peer.busy)throw new Error('A transfer is already running.');
      peer.offered={type:'offer',id:crypto.randomUUID(),hash:game.id,name:game.filename.replace(/[\p{Cc}\p{Cf}/\\]/gu,'_').slice(-120),size:game.rom.size};
      send(peer,peer.offered);show('Game offered. Waiting for the other player to accept.');
    }};
    client.on(CHANNEL.peer,listener);
    if(!host)client.timeout(5000).emit(CHANNEL.peer,{code:room.code,target:room.hostId,connection:crypto.randomUUID(),signal:{type:'hello'}},()=>{});
    try{sync();}catch{show('Invalid ICE configuration or WebRTC unavailable.');}
    const disconnected=()=>{for(const peer of [...peers.current.values()])drop(peer);show('Room disconnected. Direct connections closed.');};client.on('disconnect',disconnected);
    return ()=>{disposed=true;controls.current=null;client.off(CHANNEL.peer,listener);client.off('disconnect',disconnected);for(const peer of [...peerMap.values()])drop(peer);if(videoElement)videoElement.srcObject=null;};
  },[client,room.code,room.hostId,myId,host,spectator]);
  return <section className="room-sharing" aria-label="Room sharing and spectators">
    {spectator && <div className="spectator-screen"><div className="section-heading"><div><span className="tiny-label">FRONT ROW · SPECTATOR</span><h3>{room.stream?(picture?'Watching the live game':'Connecting to the live game…'):'Waiting for the host to start a game'}</h3></div><button className="outline-button" disabled={!audio} onClick={()=>{if(video.current){video.current.muted=false;void video.current.play().then(()=>setSound(true)).catch(()=>setMessage('Playback is unavailable. Try again.'));}}}>{sound?'Sound enabled':audio?'Enable sound':'Waiting for audio'}</button><button className="outline-button" onClick={()=>controls.current?.retry()}>Retry spectator connection</button></div><video ref={video} autoPlay playsInline muted aria-label="Spectator game stream" controls onLoadedData={()=>{setPicture(true);setMessage('Watching live. Spectators cannot send controller input.');}} onPlaying={()=>{setPicture(true);setMessage('Watching live. Spectators cannot send controller input.');}} onWaiting={()=>{setPicture(false);setMessage('Connected to host. Waiting for live picture…');}}/></div>}
    {!spectator && <><span className="tiny-label">DIRECT GAME SHARING</span><h3>Bring player two’s copy along.</h3><p>The host can offer the selected ROM directly to the other player. Accepting stores a verified copy in their local library. Share only games you have permission to distribute.</p>
    {host && <button className="outline-button" disabled={busy || !selected || !remotePlayer || !online.includes(remotePlayer.id)} onClick={()=>{void controls.current?.offer().catch(error=>setMessage(error.message));}}>Offer ROM to Player {remotePlayer?.slot || 2}</button>}
    {!host && offer && <div className="rom-offer"><strong>{offer.name} · {(offer.size/1048576).toFixed(2)} MB</strong><p>SHA-256 {offer.hash.slice(0,16)}…</p><button className="primary-button" disabled={receiving} onClick={()=>controls.current?.accept()}>{receiving?'Receiving…':'Download to my library'}</button>{!receiving && <button className="outline-button" onClick={()=>controls.current?.decline()}>Decline</button>}</div>}</>}
    <p className="room-notice" role="status">{message}</p>
    <div className="spectator-roster"><strong>Spectators {room.spectators.length}/4</strong><p>{room.spectators.length?room.spectators.map(member=>`${member.name}${member.connected?'':' (reconnecting)'}`).join(' · '):'Share this room’s code so friends can join as spectators. No ROM required to watch.'}</p></div>
  </section>;
}
