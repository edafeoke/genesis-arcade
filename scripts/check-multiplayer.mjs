import { io } from 'socket.io-client';

// Exercises the same websocket-only handshake as the browser without creating
// rooms or sending game data. Origin is explicit because the service allowlists it.
const [serviceUrl, frontendOrigin] = process.argv.slice(2);
function origin(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value) {
    throw new Error('Use an exact HTTP(S) origin without a trailing slash or path.');
  }
  return parsed.origin;
}
let socket;
try {
  if (!serviceUrl || !frontendOrigin) throw new Error('Usage: pnpm check:multiplayer <room-service-origin> <frontend-origin>');
  origin(serviceUrl);
  origin(frontendOrigin);
  const response = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
  const health = await response.json();
  if (health.ok !== true || health.service !== 'genesis-rooms') throw new Error('URL is not a healthy Genesis room service.');
  console.log('Room service health: OK');
  socket = io(serviceUrl, {
    transports: ['websocket'], reconnection: false, timeout: 20_000,
    extraHeaders: { Origin: frontendOrigin }, auth: { name: 'Deployment check' },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for a room-service session.')), 25_000);
    socket.once('session', () => { clearTimeout(timeout); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
  });
  console.log('WebSocket connection and guest session: OK');
  console.log('Next: verify video, audio and controls in two browsers.');
} catch (error) {
  console.error(`Multiplayer check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  socket?.disconnect();
}
