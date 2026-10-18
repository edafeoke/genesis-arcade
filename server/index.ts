import { createMultiplayerServer } from './app';
import { RoomStore } from './rooms';

const production = process.env.NODE_ENV === 'production';
const origins = (process.env.MULTIPLAYER_ORIGINS || (production ? '' : 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3100,http://127.0.0.1:3100')).split(',').filter(Boolean);
for (const origin of origins) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:')) throw new Error('MULTIPLAYER_ORIGINS must contain exact frontend origins; production requires HTTPS.');
}
const port = Number(process.env.MULTIPLAYER_PORT || 4001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid multiplayer port.');
const service = createMultiplayerServer({ origins, store: new RoomStore({ streaming: process.env.MULTIPLAYER_STREAMING !== 'false' }) });
service.http.listen(port, process.env.MULTIPLAYER_HOST || '127.0.0.1', () => console.log(`Genesis room service listening on port ${port}. Host streaming enabled; deterministic netplay remains unavailable.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void service.close().then(() => process.exit(0)); });
