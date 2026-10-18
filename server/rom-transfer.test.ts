import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_SHARED_ROM, validRomOffer, verifySharedRom } from '../lib/multiplayer/rom-transfer';
const bytes=new Uint8Array([0,255,64,8]);
const offer={type:'offer' as const,id:randomUUID(),hash:createHash('sha256').update(bytes).digest('hex'),name:'Demo.bin',size:bytes.length};
test('only bounded Genesis ROM offers matching the selected host game are accepted',()=>{
  assert.ok(validRomOffer(offer,offer.hash));
  for(const patch of [{name:'../game.bin'},{name:'game.exe'},{size:MAX_SHARED_ROM+1},{size:0},{size:1.5},{hash:'b'.repeat(64)},{id:'wrong'}])assert.equal(validRomOffer({...offer,...patch},offer.hash),false);
  assert.equal(validRomOffer(offer,undefined),false);
});
test('completed peer downloads verify byte length and SHA-256 before library import',async()=>{
  assert.deepEqual(new Uint8Array(await verifySharedRom([bytes.buffer],offer)),bytes);
  await assert.rejects(verifySharedRom([new Uint8Array([0,1,2,3]).buffer],offer),/hash verification/);
  await assert.rejects(verifySharedRom([new Uint8Array([0]).buffer],offer),/Incomplete/);
});
