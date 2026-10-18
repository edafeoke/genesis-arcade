import { EMULATOR_PROFILE } from './multiplayer/protocol';

export type ArcadeSave = { id: string; gameId: string; gameName: string; name: string; profile: string; createdAt: number; data: Blob };
const MAX = 16 * 1024 * 1024;
async function store<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('genesis-arcade-saves', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other arcade tabs and try again.'));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('saves', mode), request = action(tx.objectStore('saves'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Save storage failed.')); };
  });
}
export const listSaves = () => store('readonly', s => s.getAll()) as Promise<ArcadeSave[]>;
export const putSave = (save: ArcadeSave) => store('readwrite', s => s.put(save));
export const deleteSave = (id: string) => store('readwrite', s => s.delete(id));
export async function createSave(gameId: string, gameName: string, data: Blob) {
  if (!data.size || data.size > MAX) throw new Error('Invalid state size.');
  const save: ArcadeSave = { id: crypto.randomUUID(), gameId, gameName: gameName.slice(0,120), name: `Save ${new Date().toLocaleString()}`, profile: EMULATOR_PROFILE, createdAt: Date.now(), data };
  await putSave(save); return save;
}
async function digest(data: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function encodeSave(save: ArcadeSave) {
  const bytes = new Uint8Array(await save.data.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return new Blob([JSON.stringify({ format: 'genesis-save-v1', gameId: save.gameId, gameName: save.gameName, name: save.name, profile: save.profile, createdAt: save.createdAt, checksum: await digest(bytes.buffer), state: btoa(binary) })], {type:'application/json'});
}
export async function decodeSave(file: Blob): Promise<ArcadeSave> {
  if (!file.size || file.size > MAX * 1.4 + 4096) throw new Error('Save file is too large.');
  const v = JSON.parse(await file.text());
  if (v?.format !== 'genesis-save-v1' || !/^[a-f0-9]{64}$/.test(v.gameId) || v.profile !== EMULATOR_PROFILE || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 120 || typeof v.gameName !== 'string' || v.gameName.length > 120 || !Number.isSafeInteger(v.createdAt) || v.createdAt < 0 || typeof v.state !== 'string' || !/^[a-f0-9]{64}$/.test(v.checksum)) throw new Error('Unsupported or invalid Genesis save file.');
  const binary = atob(v.state);
  if (!binary.length || binary.length > MAX) throw new Error('Invalid state size.');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (await digest(bytes.buffer) !== v.checksum) throw new Error('Save checksum does not match. The file may be damaged.');
  return {id:crypto.randomUUID(),gameId:v.gameId,gameName:v.gameName,name:v.name,profile:v.profile,createdAt:v.createdAt,data:new Blob([bytes])};
}
export async function exportSave(save: ArcadeSave) {
  const url = URL.createObjectURL(await encodeSave(save));
  const link = document.createElement('a'); link.href = url;
  link.download = `${save.gameName.replace(/[^a-z0-9 _-]/gi,'_')}-${save.createdAt}.genesis-save`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
