export const MAX_SHARED_ROM = 32 * 1024 * 1024;
export type RomOffer = {type:'offer';id:string;hash:string;name:string;size:number};
export function validRomOffer(value: unknown, expectedHash: string | undefined): value is RomOffer {
  if (!value || typeof value !== 'object') return false;
  const v=value as Partial<RomOffer>;
  return v.type==='offer' && typeof v.id==='string' && /^[a-f0-9-]{36}$/.test(v.id) && typeof v.hash==='string' && /^[a-f0-9]{64}$/.test(v.hash) && v.hash===expectedHash && typeof v.name==='string' && v.name.length<=120 && /^[^\p{Cc}\p{Cf}/\\]+\.(bin|gen|md)$/iu.test(v.name) && typeof v.size==='number' && Number.isInteger(v.size) && v.size>=1 && v.size<=MAX_SHARED_ROM;
}
export async function verifySharedRom(chunks: ArrayBuffer[], offer: RomOffer) {
  if(chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0)!==offer.size)throw new Error('Incomplete ROM transfer.');
  const bytes=await new Blob(chunks).arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==offer.hash)throw new Error('ROM hash verification failed. Nothing was imported.');
  return bytes;
}
