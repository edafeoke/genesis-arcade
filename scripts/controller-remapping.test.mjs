import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source=await readFile(new URL('../public/online-player/controls.js',import.meta.url),'utf8');
function fixture(storage=new Map()){
  let root;
  const handlers=new Map(),released=[];
  const window={addEventListener:(name,fn)=>handlers.set(name,fn),dispatchEvent:event=>released.push(event.type)};
  function element(tag){return {tag,children:[],attributes:{},textContent:'',value:'',append(...nodes){this.children.push(...nodes);},setAttribute(key,value){this.attributes[key]=value;},replaceChildren(...nodes){this.children=nodes;}};}
  runInNewContext(source,{window,document:{createElement:element,querySelector:()=>({after:value=>{root=value;}})},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},Event,Object,JSON,Number});
  const find=label=>{const walk=node=>node.attributes?.['aria-label']===label?node:node.children?.map(walk).find(Boolean);return walk(root);};
  return {window,storage,released,find,key(code){let prevented=false;handlers.get('keydown')({code,preventDefault(){prevented=true;},stopImmediatePropagation(){}});return prevented;},reset(){root.children.find(node=>node.textContent==='Reset controls').onclick();}};
}
test('remapping persists across player instances and releases held controls',()=>{
  const f=fixture();f.find('Remap B keyboard').onclick();assert.ok(f.key('KeyZ'));
  assert.equal(f.window.GenesisControls.keys.KeyZ,0);assert.equal(f.window.GenesisControls.keys.KeyS,undefined);
  assert.ok(f.released.includes('genesis-controls-changed'));
  const second=fixture(f.storage);assert.equal(second.window.GenesisControls.keys.KeyZ,0);
  second.find('Remap B gamepad').value='1';second.find('Remap B gamepad').onchange();
  assert.equal(second.window.GenesisControls.pad[1],0);assert.equal(second.window.GenesisControls.pad[0],undefined);
  second.reset();assert.equal(second.window.GenesisControls.keys.KeyS,0);assert.equal(second.window.GenesisControls.pad[0],0);
});
test('Escape cancels key capture and invalid stored layouts fall back to defaults',()=>{
  const f=fixture(new Map([['genesis-online-controls-v1',JSON.stringify({keys:{KeyZ:999},pad:{}})]]));
  assert.equal(f.window.GenesisControls.keys.KeyS,0);
  f.find('Remap B keyboard').onclick();assert.ok(f.window.GenesisControls.editing);f.key('Escape');
  assert.equal(f.window.GenesisControls.editing,false);assert.equal(f.window.GenesisControls.keys.KeyS,0);
});
