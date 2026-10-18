import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSave, decodeSave, type ArcadeSave } from '../lib/saves';
import { EMULATOR_PROFILE } from '../lib/multiplayer/protocol';
const sample:ArcadeSave={id:'original',gameId:'a'.repeat(64),gameName:'Demo',name:'Before boss',profile:EMULATOR_PROFILE,createdAt:123,data:new Blob([new Uint8Array([0,1,255,7])])};
test('exported snapshots round-trip metadata and binary state without reusing save identity',async()=>{
  const restored=await decodeSave(await encodeSave(sample));
  assert.equal(restored.gameId,sample.gameId);assert.equal(restored.name,sample.name);assert.notEqual(restored.id,sample.id);
  assert.deepEqual(await restored.data.arrayBuffer(),await sample.data.arrayBuffer());
});
test('damaged snapshots, different cores and invalid ROM identities are rejected',async()=>{
  const encoded=JSON.parse(await (await encodeSave(sample)).text());
  for(const patch of [{checksum:'b'.repeat(64)},{profile:'different-core'},{gameId:'filename.bin'},{state:''},{createdAt:-1}]){
    await assert.rejects(decodeSave(new Blob([JSON.stringify({...encoded,...patch})])));
  }
  await assert.rejects(decodeSave(new Blob(['not JSON'])));
});
