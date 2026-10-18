import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source=await readFile(new URL('../public/player/bridge.js',import.meta.url),'utf8');
function fixture(){
  const listeners=new Map(),messages=[],loaded=[];
  const parent={postMessage:value=>messages.push(value)};
  const window={addEventListener:(name,fn)=>listeners.set(name,fn),EJS_emulator:{gameManager:{getState:()=>new Uint8Array([1,2,255]),loadState:bytes=>loaded.push(bytes)}}};
  const element={hidden:false};
  runInNewContext(source,{window,parent,Blob,Uint8Array,location:{origin:'http://arcade.test',search:''},URL,URLSearchParams,Event,MutationObserver:class{observe(){}},document:{body:{},head:{appendChild(){}},querySelector:()=>element,createElement:()=>({}),addEventListener(){}},Object,Element:class{}});
  const message=(data,origin='http://arcade.test',sender=parent)=>listeners.get('message')({data:{channel:'genesis-player-v1',...data},origin,source:sender});
  const id='a'.repeat(64);message({type:'load',rom:new Blob(['rom']),id});
  return {window,messages,loaded,message,id};
}
test('app save bridge captures binary states and restores only the current ROM',()=>{
  const f=fixture();f.message({type:'state-save',id:f.id,request:'save'});
  const saved=f.messages.at(-1);assert.equal(saved.type,'state-result');assert.equal(saved.request,'save');assert.equal(saved.data.size,3);
  f.message({type:'state-load',id:f.id,request:'load',data:new Uint8Array([7,8])});
  assert.deepEqual(f.loaded,[new Uint8Array([7,8])]);assert.equal(f.messages.at(-1).error,undefined);
  f.message({type:'state-load',id:'b'.repeat(64),request:'wrong',data:new Uint8Array([7])});
  assert.match(f.messages.at(-1).error,/Start this game/);assert.equal(f.loaded.length,1);
});
test('save bridge rejects other origins, unrelated windows and invalid state data',()=>{
  const f=fixture(),count=f.messages.length;
  f.message({type:'state-save',id:f.id,request:'x'},'https://evil.test');
  f.message({type:'state-save',id:f.id,request:'x'},'http://arcade.test',{});
  assert.equal(f.messages.length,count);
  f.message({type:'state-load',id:f.id,request:'bad',data:new Uint8Array()});
  assert.match(f.messages.at(-1).error,/Invalid save/);assert.equal(f.loaded.length,0);
});
test('native serialization errors return a request error without crashing the player',()=>{
  const f=fixture();f.window.EJS_emulator.gameManager.getState=()=>{throw new Error('Core unavailable');};
  f.message({type:'state-save',id:f.id,request:'failed'});
  assert.equal(f.messages.at(-1).request,'failed');assert.equal(f.messages.at(-1).error,'Core unavailable');
});
