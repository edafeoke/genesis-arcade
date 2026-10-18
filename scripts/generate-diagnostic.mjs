// Original CC0 Genesis diagnostic. Blue screen; hold Up for red.
// No commercial ROM, BIOS, graphics or sound data is included.
import { writeFile } from 'node:fs/promises';
const frameDiagnostic = process.argv.includes('--frames');
const twoPlayers = process.argv.includes('--two-players');
const rom = Buffer.alloc(65536);
rom.writeUInt32BE(0x00fffffc, 0);
for (let offset = 4; offset < 0x100; offset += 4) rom.writeUInt32BE(0x200, offset);
rom.write('SEGA GENESIS    ', 0x100, 'ascii');
rom.write('(C) 2026 GENESIS ARCADE', 0x110, 'ascii');
rom.write('GENESIS ARCADE INPUT DIAGNOSTIC', 0x120, 'ascii');
rom.write('GENESIS ARCADE INPUT DIAGNOSTIC', 0x150, 'ascii');
rom.write('GM 00000000-00', 0x180, 'ascii');
rom.write('J               ', 0x190, 'ascii');
rom.writeUInt32BE(rom.length - 1, 0x1a4);
rom.writeUInt32BE(0xff0000, 0x1a8); rom.writeUInt32BE(0xffffff, 0x1ac);
rom.write('JUE', 0x1f0, 'ascii');
let cursor = 0x200;
const labels = new Map();
const branches = [];
const emit = hex => { const bytes = Buffer.from(hex.replaceAll(' ', ''), 'hex'); bytes.copy(rom, cursor); cursor += bytes.length; };
const label = name => labels.set(name, cursor);
const branch = (opcode, name) => { emit(opcode + '0000'); branches.push([cursor - 2, name]); };
const wordTo = (word, address) => emit('33fc' + word + address);
emit('46fc2700'); // mask interrupts
emit('103900a10001 0200000f');
branch('6700', 'tmss-done');
emit('23fc5345474100a14000');
label('tmss-done');
for (const register of ['8004', '8134', '8230', '833c', '8407', '8578', '8701', '8aff', '8b00', '8c81', '8d3f', '8f02', '9001', '9100', '9200']) wordTo(register, '00c00004');
emit('23fc4000000000c00004 303c7fff');
label('clear'); wordTo('0000', '00c00000'); branch('51c8', 'clear');
wordTo('8174', '00c00004');
emit('13fc004000a10009 13fc004000a10003');
if (frameDiagnostic) {
  // Original fixture marker + VBlank counter in work RAM (not a frontend counter).
  for (const [index, word] of ['47454e45', '5349534c', '41424652', '414d4531'].entries()) {
    emit('23fc' + word + (0xff0000 + index * 4).toString(16).padStart(8, '0'));
  }
  emit('23fc0000000000ff0010');
}
if (twoPlayers) { emit('13fc004000a1000b 13fc004000a10005 323c0e00'); }
label('loop');
emit('103900a10003 02000001');
branch('6700', 'red');
if (twoPlayers) {
  emit('103900a10005 02000001'); branch('6700', 'green'); branch('6000', 'color');
  label('green'); emit('323c00e0'); branch('6000', 'color');
  label('red'); emit('323c000e');
  label('color'); emit('3001');
} else {
  emit('303c0e00'); branch('6000', 'paint'); label('red'); emit('303c000e');
}
label('paint'); emit('23fcc002000000c00004 33c000c00000');
if (frameDiagnostic) {
  label('vblank-start'); emit('303900c00004 02400008'); branch('6700', 'vblank-start');
  emit('52b900ff0010'); // addq.l #1,$ff0010
  label('vblank-end'); emit('303900c00004 02400008'); branch('6600', 'vblank-end');
}
branch('6000', 'loop');
for (const [offset, target] of branches) rom.writeInt16BE(labels.get(target) - offset, offset);
let checksum = 0;
for (let offset = 0x200; offset < rom.length; offset += 2) checksum = (checksum + rom.readUInt16BE(offset)) & 0xffff;
rom.writeUInt16BE(checksum, 0x18e);
const output = process.argv[2] || '/tmp/genesis-diagnostic.bin';
await writeFile(output, rom);
console.log(`Wrote ${output}: blue screen, hold Up for red${frameDiagnostic ? ', with VBlank counter' : ''} (CC0).`);
