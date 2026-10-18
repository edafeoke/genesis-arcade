// Original CC0 two-player Sega Genesis homebrew. No third-party ROM/assets.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const rom = Buffer.alloc(65536);
rom.writeUInt32BE(0x00fffffc, 0);
for (let offset = 4; offset < 0x100; offset += 4) rom.writeUInt32BE(0x200, offset);
rom.write('SEGA GENESIS    ',0x100); rom.write('(C)2026 CC0 GENESIS ARCADE',0x110);
rom.write('QUICKDRAW DUEL',0x120); rom.write('QUICKDRAW DUEL',0x150); rom.write('GM 00000001-00',0x180); rom.write('J',0x190);
rom.writeUInt32BE(65535,0x1a4); rom.writeUInt32BE(0xff0000,0x1a8); rom.writeUInt32BE(0xffffff,0x1ac); rom.write('JUE',0x1f0);
let cursor=0x200; const labels=new Map(), branches=[];
const emit=hex=>{const bytes=Buffer.from(hex.replaceAll(' ',''),'hex'); bytes.copy(rom,cursor);cursor+=bytes.length;};
const label=name=>labels.set(name,cursor);
const branch=(op,name)=>{emit(op+'0000');branches.push([cursor-2,name]);};
const word=(value,address='00c00000')=>emit('33fc'+value.toString(16).padStart(4,'0')+address);
const byte=(value,address)=>emit('13fc'+value.toString(16).padStart(4,'0')+address);
const command=value=>emit('23fc'+(value>>>0).toString(16).padStart(8,'0')+'00c00004');
const vram=address=>command((0x40000000|((address&0x3fff)<<16)|((address&0xc000)>>>14))>>>0);
const color=value=>{command(0xc0040000);word(value);};
const tone=period=>{byte(0x80|(period&15),'00c00011');byte((period>>>4)&63,'00c00011');byte(0x94,'00c00011');};
const mute=()=>byte(0x9f,'00c00011');
const glyphs={
'A':['01110','10001','10001','11111','10001','10001','10001'],
'B':['11110','10001','10001','11110','10001','10001','11110'],
'C':['01111','10000','10000','10000','10000','10000','01111'],
'D':['11110','10001','10001','10001','10001','10001','11110'],
'E':['11111','10000','10000','11110','10000','10000','11111'],
'F':['11111','10000','10000','11110','10000','10000','10000'],
'G':['01111','10000','10000','10111','10001','10001','01111'],
'H':['10001','10001','10001','11111','10001','10001','10001'],
'I':['11111','00100','00100','00100','00100','00100','11111'],
'J':['00111','00010','00010','00010','10010','10010','01100'],
'K':['10001','10010','10100','11000','10100','10010','10001'],
'L':['10000','10000','10000','10000','10000','10000','11111'],
'M':['10001','11011','10101','10101','10001','10001','10001'],
'N':['10001','11001','10101','10011','10001','10001','10001'],
'O':['01110','10001','10001','10001','10001','10001','01110'],
'P':['11110','10001','10001','11110','10000','10000','10000'],
'Q':['01110','10001','10001','10001','10101','10010','01101'],
'R':['11110','10001','10001','11110','10100','10010','10001'],
'S':['01111','10000','10000','01110','00001','00001','11110'],
'T':['11111','00100','00100','00100','00100','00100','00100'],
'U':['10001','10001','10001','10001','10001','10001','01110'],
'V':['10001','10001','10001','10001','10001','01010','00100'],
'W':['10001','10001','10001','10101','10101','10101','01010'],
'X':['10001','10001','01010','00100','01010','10001','10001'],
'Y':['10001','10001','01010','00100','00100','00100','00100'],
'Z':['11111','00001','00010','00100','01000','10000','11111'],
'1':['00100','01100','00100','00100','00100','00100','01110'],
'2':['01110','10001','00001','00010','00100','01000','11111'],
'!':['00100','00100','00100','00100','00100','00000','00100'],
'.':['00000','00000','00000','00000','00000','00100','00100'],
};
const indices=new Map(Object.keys(glyphs).map((char,index)=>[char,index+1]));
const text=(row,value)=>{vram(0xc000+row*128+8*2);for(const char of value.padEnd(24,' '))word(indices.get(char)||0);};
emit('46fc2700 103900a10001 0200000f');branch('6700','tmss');emit('23fc5345474100a14000');label('tmss');
for(const reg of [0x8004,0x8134,0x8230,0x833c,0x8407,0x8578,0x8702,0x8aff,0x8b00,0x8c81,0x8d3f,0x8f02,0x9001,0x9100,0x9200])word(reg,'00c00004');
vram(0);emit('303c7fff');label('clear');word(0);branch('51c8','clear');
vram(32);
for(const rows of Object.values(glyphs))for(const row of [...rows,'00000']){
 const pixels=('0'+row+'00').split('').map(bit=>bit==='1'?'1':'0').join('');word(parseInt(pixels.slice(0,4),16));word(parseInt(pixels.slice(4),16));
}
command(0xc0000000);word(0);word(0xeee);word(0x600);
text(3,'QUICKDRAW DUEL');text(5,'TWO PLAYERS . ONE SIGNAL');text(9,'PRESS START');text(13,'WAIT FOR GREEN');text(15,'THEN PRESS B FIRST');text(18,'EARLY PRESS LOSES');text(23,'ORIGINAL CC0 HOMEBREW');
for(const port of ['00a10009','00a1000b','00a10003','00a10005'])byte(0x40,port);
for(const volume of [0x9f,0xbf,0xdf,0xff])byte(volume,'00c00011');
emit('7200 7400 7600');word(0x8174,'00c00004');
label('frame');
label('vblank-start');emit('303900c00004 02400008');branch('6700','vblank-start');
label('vblank-end');emit('303900c00004 02400008');branch('6600','vblank-end');emit('5241');
// State 0 awaits Start. State 3 announces a winner and allows a rematch.
emit('0c420000');branch('6700','start-check');emit('0c420003');branch('6600','active');
emit('4a43');branch('6700','start-check');emit('5343');branch('6600','start-check');mute();
label('start-check');byte(0,'00a10003');byte(0,'00a10005');
emit('1c3900a10003 02060020 1e3900a10005 02070020');
byte(0x40,'00a10003');byte(0x40,'00a10005');
emit('4a06');branch('6700','start');emit('4a07');branch('6700','start');branch('6000','frame');
label('start');emit('343c0001 3601 0243007f 0643005a');mute();color(0x600);text(9,'WAIT...');text(11,'');branch('6000','frame');
label('active');emit('0c420001');branch('6600','buttons');emit('5343');branch('6600','buttons');
emit('343c0002');color(0x080);text(9,'GO! PRESS B');tone(260);
label('buttons');emit('1c3900a10003 02060010 1e3900a10005 02070010');
emit('4a06');branch('6600','player2-check');emit('4a07');branch('6700','tie');
emit('0c420001');branch('6700','player2-win');branch('6000','player1-win');
label('player2-check');emit('4a07');branch('6600','frame');emit('0c420001');branch('6700','player1-win');branch('6000','player2-win');
label('player1-win');color(0xa00);text(9,'PLAYER 1 WINS!');tone(180);branch('6000','over');
label('player2-win');color(0x00a);text(9,'PLAYER 2 WINS!');tone(350);branch('6000','over');
label('tie');color(0x444);text(9,'TIE!');tone(220);
label('over');emit('343c0003 363c0014');text(11,'START FOR REMATCH');branch('6000','frame');
for(const [offset,target]of branches){if(!labels.has(target))throw Error(target);rom.writeInt16BE(labels.get(target)-offset,offset);}
if(cursor>rom.length)throw Error('ROM too large');
let sum=0;for(let offset=0x200;offset<rom.length;offset+=2)sum=(sum+rom.readUInt16BE(offset))&65535;rom.writeUInt16BE(sum,0x18e);
await mkdir('public/demos',{recursive:true});await writeFile('public/demos/Quickdraw Duel.bin',rom);
const hash=createHash('sha256').update(rom).digest('hex');
await writeFile('public/demos/quickdraw.json',JSON.stringify({name:'Quickdraw Duel',filename:'Quickdraw Duel.bin',hash,license:'CC0-1.0',size:rom.length},null,2)+'\n');
console.log(`Quickdraw Duel: ${cursor-0x200} code bytes; SHA-256 ${hash}`);
