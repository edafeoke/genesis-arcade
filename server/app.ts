import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { CHANNEL, authSchema, schemas, type Reply, type GameMetadata, type StreamSignal } from '../lib/multiplayer/protocol';
import { RoomError, RoomStore } from './rooms';

export class RateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  constructor(private now: () => number = Date.now) {}
  allow(key: string, limit: number, windowMs: number) {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (bucket && bucket.until <= now) { this.buckets.delete(key); bucket = undefined; }
    if (!bucket) {
      if (this.buckets.size >= 10000) return false;
      bucket = { count: 0, until: now + windowMs }; this.buckets.set(key, bucket);
    }
    return ++bucket.count <= limit;
  }
  sweep() { for (const [key, bucket] of this.buckets) if (bucket.until <= this.now()) this.buckets.delete(key); }
}
export function createMultiplayerServer({ origins, store = new RoomStore() }: { origins: string[]; store?: RoomStore }) {
  if (!origins.length) throw new Error('At least one frontend origin is required.');
  const limiter = new RateLimiter();
  const http = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, service: 'genesis-rooms', syncAvailable: false }));
    } else { response.writeHead(404); response.end(); }
  });
  const io: Server = new Server(http, {
    serveClient: false, transports: ['websocket'], maxHttpBufferSize: 32768,
    cors: { origin: origins, methods: ['GET', 'POST'] },
    allowRequest: (request, done) => {
      const allowed = !!request.headers.origin && origins.includes(request.headers.origin);
      const limited = limiter.allow(`connect:${request.socket.remoteAddress}`, 30, 60_000);
      done(null, allowed && limited && io.engine.clientsCount < 1000);
    },
  });
  store.onUpdate = (room, sockets) => { for (const id of sockets) io.to(id).emit('room:update', room); };
  store.onClosed = (reason, sockets) => { for (const id of sockets) io.to(id).emit('room:closed', { message: reason }); };
  io.use((socket, next) => {
    const auth = authSchema.safeParse(socket.handshake.auth);
    if (!auth.success) { next(new Error('Use a display name of 1–24 characters and a valid session credential.')); return; }
    if (io.engine.clientsCount > 1000) { next(new Error('The service is at capacity.')); return; }
    // Only validate here. Creating a session before connection completes can leak it.
    socket.data.auth = auth.data;
    next();
  });
  io.on('connection', socket => {
    let hello;
    try {
      const connected = store.connect(socket.id, socket.data.auth.name, socket.data.auth.token);
      hello = connected.hello;
      if (connected.previousSocketId && connected.previousSocketId !== socket.id) {
        io.sockets.sockets.get(connected.previousSocketId)?.emit('session:replaced');
        io.sockets.sockets.get(connected.previousSocketId)?.disconnect(true);
      }
    } catch { socket.emit('room:error', 'The service is at capacity. Try again later.'); socket.disconnect(true); return; }
    socket.emit('session', hello);
    const ip = socket.handshake.address;
    socket.use((packet, next) => {
      const [event, payload, ack] = packet;
      const reply = typeof ack === 'function' ? ack as (result: Reply) => void : undefined;
      if (event !== CHANNEL.signal && Buffer.byteLength(JSON.stringify(payload) || '') > 4096) { socket.disconnect(true); return; }
      if (event === CHANNEL.signal) {
        if (!limiter.allow(`signal:${socket.id}`, 100, 10_000) || !limiter.allow(`signal-ip:${ip}`, 400, 10_000)) { socket.disconnect(true); return; }
        const signal = schemas[CHANNEL.signal].safeParse(payload);
        if (!signal.success || !reply) { reply?.({ ok: false, code: 'INVALID_MESSAGE', message: 'Invalid session signaling.' }); return; }
        packet[1] = signal.data; next(); return;
      }
      if (!limiter.allow(`packet:${socket.id}`, 60, 10_000) || !limiter.allow(`ip:${ip}`, 300, 10_000)) {
        reply?.({ ok: false, code: 'RATE_LIMIT', message: 'Too many requests. Wait a moment before reconnecting.' });
        socket.disconnect(true); return;
      }
      const schema = Object.hasOwn(schemas, event) ? schemas[event as keyof typeof schemas] : undefined;
      const valid = schema?.safeParse(payload);
      if (!valid?.success || !reply) {
        reply?.({ ok: false, code: 'INVALID_MESSAGE', message: 'Invalid or unsupported message.' }); return;
      }
      // Disallow unknown fields (including ROM data) before reaching handlers.
      packet[1] = valid.data;
      next();
    });
    const handle = (event: string, action: (data: Record<string, unknown>) => Omit<Extract<Reply, { ok: true }>, 'ok'> | void) => {
      socket.on(event, (data: Record<string, unknown>, ack: (result: Reply) => void) => {
        try { ack({ ok: true, ...action(data) }); }
        catch (error) { ack({ ok: false, code: error instanceof RoomError ? error.code : 'INTERNAL', message: error instanceof RoomError ? error.message : 'The request could not be completed.' }); }
      });
    };
    handle(CHANNEL.create, data => {
      if (!limiter.allow(`create:${ip}`, 3, 60_000)) throw new RoomError('RATE_LIMIT', 'Room creation is limited to three per minute.');
      return store.create(socket.id, { visibility: data.visibility as 'private' | 'public' | undefined, game: data.game as GameMetadata | undefined });
    });
    handle(CHANNEL.join, data => {
      if (!limiter.allow(`join:${ip}`, 15, 60_000)) throw new RoomError('RATE_LIMIT', 'Too many join attempts. Try again in a minute.');
      return { room: store.join(socket.id, data.code as string, data.inviteToken as string | undefined) };
    });
    handle(CHANNEL.list, data => {
      if (!limiter.allow(`list:${socket.id}`, 30, 60_000) || !limiter.allow(`list-ip:${ip}`, 300, 60_000)) throw new RoomError('RATE_LIMIT', 'Lobby refreshes are limited. Wait a moment, then try again.');
      return store.listPublic(socket.id, data.query as string, data.offset as number);
    });
    handle(CHANNEL.joinPublic, data => {
      if (!limiter.allow(`join:${ip}`, 15, 60_000)) throw new RoomError('RATE_LIMIT', 'Too many join attempts. Try again in a minute.');
      return { room: store.joinPublic(socket.id, data.id as string) };
    });
    handle(CHANNEL.game, data => ({ room: store.selectGame(socket.id, data.game as GameMetadata | null) }));
    handle(CHANNEL.ready, data => ({ room: store.ready(socket.id, data.ready as boolean) }));
    handle(CHANNEL.swap, () => ({ room: store.swap(socket.id) }));
    handle(CHANNEL.leave, () => { store.leave(socket.id); });
    handle(CHANNEL.start, () => store.start(socket.id));
    handle(CHANNEL.streamStart, () => store.startStream(socket.id));
    handle(CHANNEL.streamStop, data => store.stopStream(socket.id, data.epoch as string));
    handle(CHANNEL.signal, data => {
      const signal = data as StreamSignal;
      io.to(store.relayStream(socket.id, signal)).emit(CHANNEL.signal, signal);
    });
    handle(CHANNEL.ping, () => { store.pingStream(socket.id); return { serverTime: Date.now() }; });
    socket.on('disconnect', () => store.disconnect(socket.id));
  });
  const interval = setInterval(() => { store.sweep(); limiter.sweep(); }, 5000);
  interval.unref();
  return { http, io, store, close: async () => { clearInterval(interval); await new Promise<void>(resolve => io.close(() => resolve())); } };
}
