export type Game = { id: string; name: string; filename: string; size: number; addedAt: number; favorite: boolean; rom: Blob };

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('genesis-arcade', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('games', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Genesis Arcade tabs and try again.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('games', mode);
    const request = action(tx.objectStore('games'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Library storage failed.')); };
  });
}
export const listGames = () => transaction('readonly', store => store.getAll()) as Promise<Game[]>;
export const saveGame = (game: Game) => transaction('readwrite', store => store.put(game));
export const removeGame = (id: string) => transaction('readwrite', store => store.delete(id));
export async function importGame(file: File): Promise<Game> {
  if (!/\.(md|gen|bin)$/i.test(file.name)) throw new Error('Choose an uncompressed .md, .gen, or .bin ROM.');
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('ROM files must be between 1 byte and 32 MB.');
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const existing = (await listGames()).find(game => game.id === id);
  if (existing) return existing;
  const game: Game = { id, name: file.name.replace(/\.[^.]+$/, '').replace(/[_]/g, ' '), filename: file.name, size: file.size, addedAt: Date.now(), favorite: false, rom: new Blob([bytes]) };
  await saveGame(game);
  return game;
}
