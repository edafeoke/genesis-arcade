import { z } from 'zod';

export const EMULATOR_PROFILE = 'ejs4.2.3:genesis-plus-gx2.0.2:legacy:single-thread:v1';
export const CHANNEL = {
  create: 'room:create', join: 'room:join', game: 'room:game', ready: 'room:ready',
  swap: 'room:swap', leave: 'room:leave', start: 'room:start', ping: 'room:ping',
  list: 'lobby:list', joinPublic: 'lobby:join',
  watch: 'room:watch', watchPublic: 'lobby:watch', peer: 'room:peer',
  streamStart: 'stream:start', streamStop: 'stream:stop', signal: 'stream:signal',
} as const;
const peerSignalSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('hello')}).strict(),
  z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(24000).startsWith('v=0') }).strict(),
  z.object({ type: z.literal('candidate'), candidate: z.string().max(2048), sdpMid: z.string().max(64).nullable(), sdpMLineIndex: z.number().int().min(0).max(32).nullable() }).strict(),
]);
const cleanText = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}]*$/u);
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const codeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{10}$/);
export const gameSchema = z.object({
  name: cleanText(120), hash: z.string().regex(/^[a-f0-9]{64}$/),
  profile: z.string().min(1).max(120), multiplayerConfirmed: z.boolean(),
}).strict();
export const authSchema = z.object({ name: cleanText(24), token: tokenSchema.optional() }).strict();
export const schemas = {
  [CHANNEL.watch]: z.object({ code: codeSchema, inviteToken: tokenSchema.optional() }).strict(),
  [CHANNEL.watchPublic]: z.object({ id: z.string().uuid() }).strict(),
  [CHANNEL.peer]: z.object({ code: codeSchema, target: z.string().uuid(), connection: z.string().uuid(), signal: peerSignalSchema }).strict(),
  [CHANNEL.create]: z.union([
    z.object({ visibility: z.literal('private').optional() }).strict(),
    z.object({ visibility: z.literal('public'), game: gameSchema }).strict(),
  ]),
  [CHANNEL.list]: z.object({ query: z.string().trim().max(80).regex(/^[^\p{Cc}\p{Cf}]*$/u).default(''), offset: z.number().int().min(0).max(500).default(0) }).strict(),
  [CHANNEL.joinPublic]: z.object({ id: z.string().uuid() }).strict(),
  [CHANNEL.join]: z.object({ code: codeSchema, inviteToken: tokenSchema.optional() }).strict(),
  [CHANNEL.game]: z.object({ game: gameSchema.nullable() }).strict(),
  [CHANNEL.ready]: z.object({ ready: z.boolean() }).strict(),
  [CHANNEL.swap]: z.object({}).strict(),
  [CHANNEL.leave]: z.object({}).strict(),
  [CHANNEL.start]: z.object({}).strict(),
  [CHANNEL.ping]: z.object({}).strict(),
  [CHANNEL.streamStart]: z.object({}).strict(),
  [CHANNEL.streamStop]: z.object({ epoch: z.string().uuid() }).strict(),
  [CHANNEL.signal]: z.object({ epoch: z.string().uuid(), signal: z.discriminatedUnion('type', [
    z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(24000).startsWith('v=0') }).strict(),
    z.object({ type: z.literal('candidate'), candidate: z.string().max(2048), sdpMid: z.string().max(64).nullable(), sdpMLineIndex: z.number().int().min(0).max(32).nullable() }).strict(),
  ]) }).strict(),
};
export type StreamSession = { epoch: string; hostId: string; hostSlot: 1 | 2; gameHash: string; startedAt: number };
export type StreamSignal = z.infer<typeof schemas['stream:signal']>;
export type GameMetadata = z.infer<typeof gameSchema>;
export type Compatibility = 'waiting' | 'rom-mismatch' | 'profile-mismatch' | 'matched';
export type RoomPlayer = { id: string; name: string; slot: 1 | 2; connected: boolean; ready: boolean; game: GameMetadata | null };
export type RoomSnapshot = {
  code: string; visibility: 'private' | 'public'; hostId: string; expiresAt: number; players: RoomPlayer[]; spectators: { id: string; name: string; connected: boolean }[];
  compatibility: Compatibility; syncAvailable: false; streamAvailable: boolean; stream: StreamSession | null;
};
export const LOBBY_PAGE_SIZE = 50;
export type PublicLobby = { id: string; gameName: string; players: number; readyPlayers: number; capacity: 2; spectators: number; spectatorCapacity: number; status: 'waiting' | 'full' | 'host-away'; modeConfirmed: boolean; expiresAt: number };
export type LobbyPage = { lobbies: PublicLobby[]; total: number; offset: number };
export type SessionHello = { id: string; token: string; restored: boolean; room: RoomSnapshot | null };
export type Reply = { ok: true; room?: RoomSnapshot; inviteToken?: string; serverTime?: number; lobbies?: PublicLobby[]; total?: number; offset?: number } | { ok: false; code: string; message: string };
export function compatibility(players: Pick<RoomPlayer, 'game'>[]): Compatibility {
  if (players.length !== 2 || players.some(player => !player.game)) return 'waiting';
  if (players[0].game!.hash !== players[1].game!.hash) return 'rom-mismatch';
  if (players[0].game!.profile !== players[1].game!.profile) return 'profile-mismatch';
  return 'matched';
}

export type RoomPeerSignal = z.infer<typeof schemas['room:peer']> & { from: string };
