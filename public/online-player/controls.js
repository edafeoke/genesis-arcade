/* Persistent browser-local keyboard and standard-gamepad mappings. */
(() => {
  const defaults = {ArrowUp:4,ArrowDown:5,ArrowLeft:6,ArrowRight:7,KeyA:1,KeyS:0,KeyD:8,KeyQ:10,KeyW:9,KeyE:11,Enter:3,ShiftRight:2};
  const defaultPad = {0:0,1:8,2:1,3:9,4:10,5:11,8:2,9:3,12:4,13:5,14:6,15:7};
  const labels = {4:'Up',5:'Down',6:'Left',7:'Right',1:'A',0:'B',8:'C',10:'X',9:'Y',11:'Z',2:'Mode',3:'Start'};
  let keys={...defaults}, pad={...defaultPad}, editing;
  try {
    const value=JSON.parse(localStorage.getItem('genesis-online-controls-v1'));
    if(value && valid(value.keys,false) && valid(value.pad,true)){keys=value.keys;pad=value.pad;}
  } catch { /* Storage may be unavailable; session remapping still works. */ }
  function valid(value, gamepad) {return value && typeof value==='object' && Object.keys(value).length<=32 && Object.entries(value).every(([key,button])=>(gamepad ? /^\d{1,2}$/.test(key) && Number(key)<32 : /^[A-Za-z][A-Za-z0-9]{0,30}$/.test(key)) && Object.hasOwn(labels,button));}
  const root=document.createElement('details'); root.id='controller-remapping';
  const title=document.createElement('summary');title.textContent='Remap controller';root.append(title);
  const hint=document.createElement('p');hint.textContent='Choose a key, then press its replacement. Gamepad buttons use standard button indices. Shared-keyboard mode uses its fixed two-player layout.';root.append(hint);
  const grid=document.createElement('div');grid.className='mapping-grid';root.append(grid);
  const message=document.createElement('p');message.setAttribute('role','status');root.append(message);
  function save(){window.dispatchEvent(new Event('genesis-controls-changed'));try{localStorage.setItem('genesis-online-controls-v1',JSON.stringify({keys,pad}));message.textContent='Controls saved in this browser.';}catch{message.textContent='Controls changed for this session; storage unavailable.';}render();}
  function render(){grid.replaceChildren();for(const [button,label] of Object.entries(labels)){
    const row=document.createElement('label');row.textContent=label;
    const key=document.createElement('button');key.type='button';key.textContent=editing===Number(button)?'Press a key…':Object.keys(keys).find(code=>keys[code]===Number(button))||'Unassigned';key.setAttribute('aria-label',`Remap ${label} keyboard`);key.onclick=()=>{editing=Number(button);window.dispatchEvent(new Event('genesis-controls-changed'));render();};row.append(key);
    const select=document.createElement('select');select.setAttribute('aria-label',`Remap ${label} gamepad`);
    const none=document.createElement('option');none.value='';none.textContent='No pad button';select.append(none);
    for(let index=0;index<32;index++){const option=document.createElement('option');option.value=String(index);option.textContent=`Pad button ${index}`;select.append(option);}
    select.value=Object.keys(pad).find(index=>pad[index]===Number(button))??'';
    select.onchange=()=>{for(const index of Object.keys(pad))if(pad[index]===Number(button))delete pad[index];if(select.value!=='')pad[select.value]=Number(button);save();};row.append(select);grid.append(row);
  }}
  window.addEventListener('keydown',event=>{if(editing===undefined)return;event.preventDefault();event.stopImmediatePropagation();if(event.code==='Escape'){editing=undefined;render();return;}if(!/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(event.code))return;for(const code of Object.keys(keys))if(keys[code]===editing)delete keys[code];keys[event.code]=editing;editing=undefined;save();},true);
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset controls';reset.onclick=()=>{keys={...defaults};pad={...defaultPad};editing=undefined;save();};root.append(reset);
  document.querySelector('#input-bar').after(root);render();
  window.GenesisControls={get keys(){return keys;},get pad(){return pad;},get editing(){return editing!==undefined;}};
})();
