import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { LOBBY_PAGE_SIZE, type LobbyPage, type PublicLobby, compatibility, type GameMetadata, type RoomPlayer, type RoomSnapshot, type StreamSession, type StreamSignal } from '../lib/multiplayer/protocol';

type Member = { id: string; token: string; name: string; socketId: string | null; roomCode: string | null; disconnectedAt: number | null; slot: 1 | 2; ready: boolean; game: GameMetadata | null };
type Room = { visibility: 'private' | 'public'; publicId: string | null; code: string; inviteToken: string; hostId: string; members: Member[]; createdAt: number; updatedAt: number; stream: StreamSession | null };
export class RoomError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export class RoomStore {
  private rooms = new Map<string, Room>();
  private sessions = new Map<string, Member>();
  private sockets = new Map<string, Member>();
  onUpdate: (room: RoomSnapshot, sockets: string[]) => void = () => {};
  onClosed: (reason: string, sockets: string[]) => void = () => {};
  readonly graceMs: number;
  readonly idleMs: number;
  readonly lifetimeMs: number;
  constructor(private options: { now?: () => number; graceMs?: number; idleMs?: number; lifetimeMs?: number; maxRooms?: number; maxSessions?: number; streaming?: boolean } = {}) {
    this.graceMs = options.graceMs ?? 60_000;
    this.idleMs = options.idleMs ?? 15 * 60_000;
    this.lifetimeMs = options.lifetimeMs ?? 2 * 60 * 60_000;
  }
  private now() { return (this.options.now ?? Date.now)(); }
  connect(socketId: string, name: string, token?: string) {
    this.sweep();
    let member = token ? this.sessions.get(token) : undefined;
    const restored = !!member;
    const previousSocketId = member?.socketId;
    if (!member) {
      if (this.sessions.size >= (this.options.maxSessions ?? 1000)) throw new RoomError('CAPACITY', 'The service is at capacity. Try again later.');
      member = { id: randomUUID(), token: randomBytes(32).toString('base64url'), name, socketId, roomCode: null, disconnectedAt: null, slot: 1, ready: false, game: null };
      this.sessions.set(member.token, member);
    }
    if (previousSocketId) this.sockets.delete(previousSocketId);
    member.socketId = socketId;
    member.name = name;
    member.disconnectedAt = null;
    member.ready = false;
    this.sockets.set(socketId, member);
    if (member.roomCode) {
      const room = this.rooms.get(member.roomCode)!;
      this.resetReady(room); this.publish(room);
    }
    return { previousSocketId, hello: { id: member.id, token: member.token, restored, room: member.roomCode ? this.snapshot(this.rooms.get(member.roomCode)!) : null } };
  }
  private member(socketId: string) {
    const member = this.sockets.get(socketId);
    if (!member || member.socketId !== socketId) throw new RoomError('SESSION', 'Reconnect to the multiplayer service.');
    return member;
  }
  private membership(socketId: string) {
    this.sweep();
    const member = this.member(socketId);
    const room = member.roomCode ? this.rooms.get(member.roomCode) : undefined;
    if (!room) throw new RoomError('MEMBERSHIP', 'Join a room first.');
    return { member, room };
  }
  private snapshot(room: Room): RoomSnapshot {
    const players: RoomPlayer[] = room.members.map(({ id, name, slot, socketId, ready, game }) => ({ id, name, slot, connected: !!socketId, ready, game: game ? { ...game } : null })).sort((a, b) => a.slot - b.slot);
    return { code: room.code, visibility: room.visibility, hostId: room.hostId, expiresAt: Math.min(room.updatedAt + this.idleMs, room.createdAt + this.lifetimeMs), players, compatibility: compatibility(players), syncAvailable: false, streamAvailable: !!this.options.streaming, stream: room.stream ? { ...room.stream } : null };
  }
  private publish(room: Room) { this.onUpdate(this.snapshot(room), room.members.flatMap(member => member.socketId ? [member.socketId] : [])); }
  private resetReady(room: Room) { room.stream = null; for (const member of room.members) member.ready = false; }
  private touch(room: Room) { room.updatedAt = this.now(); }
  create(socketId: string, options: { visibility?: 'private' | 'public'; game?: GameMetadata } = {}) {
    this.sweep();
    const member = this.member(socketId);
    if (member.roomCode) throw new RoomError('ALREADY_IN_ROOM', 'Leave your current room before creating another.');
    if (this.rooms.size >= (this.options.maxRooms ?? 500)) throw new RoomError('CAPACITY', 'No rooms available. Try again later.');
    const visibility = options.visibility ?? 'private';
    if (visibility === 'public' && !options.game) throw new RoomError('GAME_REQUIRED', 'Select a local game before creating a public room.');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do { code = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (this.rooms.has(code));
    const room: Room = { visibility, publicId: visibility === 'public' ? randomUUID() : null, code, inviteToken: randomBytes(32).toString('base64url'), hostId: member.id, members: [member], createdAt: this.now(), updatedAt: this.now(), stream: null };
    member.roomCode = code; member.slot = 1; member.ready = false; member.game = visibility === 'public' ? { ...options.game! } : null;
    this.rooms.set(code, room); this.publish(room);
    return { room: this.snapshot(room), inviteToken: room.inviteToken };
  }
  join(socketId: string, code: string, inviteToken?: string) {
    this.sweep();
    const member = this.member(socketId);
    if (member.roomCode) throw new RoomError('ALREADY_IN_ROOM', 'Leave your current room before joining another.');
    const room = this.rooms.get(code);
    if (!room || (inviteToken !== undefined && !this.equalToken(inviteToken, room.inviteToken))) throw new RoomError('ROOM_UNAVAILABLE', 'Room or invitation is invalid or expired.');
    if (!room.members.some(player => player.id === room.hostId && player.socketId)) throw new RoomError('HOST_AWAY', 'The host is reconnecting. Try again shortly.');
    if (room.members.length >= 2) throw new RoomError('ROOM_FULL', 'This room is full, including reconnecting players.');
    member.roomCode = code; member.slot = room.members[0].slot === 1 ? 2 : 1; member.game = null; member.ready = false;
    room.members.push(member); this.resetReady(room); this.touch(room); this.publish(room);
    return this.snapshot(room);
  }
  listPublic(socketId: string, query = '', offset = 0): LobbyPage {
    this.sweep(); this.member(socketId);
    const matches = [...this.rooms.values()].filter(room => {
      const host = room.members.find(member => member.id === room.hostId)!;
      return room.visibility === 'public' && host.game && host.game.name.toLowerCase().includes(query.toLowerCase());
    }).sort((a, b) => b.createdAt - a.createdAt || a.publicId!.localeCompare(b.publicId!));
    const lobbies: PublicLobby[] = matches.slice(offset, offset + LOBBY_PAGE_SIZE).map(room => {
      const host = room.members.find(member => member.id === room.hostId)!;
      return {
        id: room.publicId!, gameName: host.game!.name, players: room.members.length,
        readyPlayers: room.members.filter(member => member.ready).length, capacity: 2,
        status: !host.socketId ? 'host-away' : room.members.length === 2 ? 'full' : 'waiting',
        modeConfirmed: host.game!.multiplayerConfirmed,
        expiresAt: Math.min(room.updatedAt + this.idleMs, room.createdAt + this.lifetimeMs),
      };
    });
    return { lobbies, total: matches.length, offset };
  }
  joinPublic(socketId: string, id: string) {
    this.sweep(); this.member(socketId);
    const room = [...this.rooms.values()].find(room => room.visibility === 'public' && room.publicId === id);
    if (!room || !room.members.find(member => member.id === room.hostId)?.game) throw new RoomError('ROOM_UNAVAILABLE', 'This public room is no longer available. Refresh the lobby.');
    // The existing atomic join checks membership, host presence and reserved capacity.
    return this.join(socketId, room.code);
  }
  private equalToken(a: string, b: string) {
    const left = Buffer.from(a), right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  selectGame(socketId: string, game: GameMetadata | null) {
    const { member, room } = this.membership(socketId);
    if (room.stream) throw new RoomError('SESSION_ACTIVE', 'End the game before changing the waiting room.');
    member.game = game ? { ...game } : null; this.resetReady(room); this.touch(room); this.publish(room);
    return this.snapshot(room);
  }
  ready(socketId: string, ready: boolean) {
    const { member, room } = this.membership(socketId);
    if (room.stream) throw new RoomError('SESSION_ACTIVE', 'End the game before changing the waiting room.');
    if (ready && (compatibility(room.members) !== 'matched' || room.members.some(player => !player.socketId) || !member.game?.multiplayerConfirmed)) throw new RoomError('NOT_COMPATIBLE', 'Both players must be connected with matching ROMs and emulator profiles. Confirm the game has a two-player mode.');
    member.ready = ready; this.touch(room); this.publish(room); return this.snapshot(room);
  }
  swap(socketId: string) {
    const { member, room } = this.membership(socketId);
    if (room.stream) throw new RoomError('SESSION_ACTIVE', 'End the game before changing the waiting room.');
    if (member.id !== room.hostId) throw new RoomError('HOST_ONLY', 'Only the host may assign controller positions.');
    for (const player of room.members) player.slot = player.slot === 1 ? 2 : 1;
    this.resetReady(room); this.touch(room); this.publish(room); return this.snapshot(room);
  }
  start(socketId: string): never {
    const { member, room } = this.membership(socketId);
    if (member.id !== room.hostId) throw new RoomError('HOST_ONLY', 'Only the host may start the session.');
    if (room.members.length !== 2 || room.members.some(player => !player.socketId || !player.ready || !player.game?.multiplayerConfirmed) || compatibility(room.members) !== 'matched') throw new RoomError('NOT_READY', 'Both players must have compatible games and be ready.');
    throw new RoomError('SYNC_UNAVAILABLE', 'Synchronized gameplay is not implemented. This room is a networking waiting-room prototype.');
  }
  startStream(socketId: string) {
    const { member, room } = this.membership(socketId);
    if (!this.options.streaming) throw new RoomError('STREAM_UNAVAILABLE', 'Host streaming is unavailable on this service.');
    if (member.id !== room.hostId) throw new RoomError('HOST_ONLY', 'Only the host may start the game.');
    if (room.stream) throw new RoomError('SESSION_ACTIVE', 'A game is already running.');
    if (room.members.length !== 2 || room.members.some(player => !player.socketId || !player.ready || !player.game?.multiplayerConfirmed) || compatibility(room.members) !== 'matched') throw new RoomError('NOT_READY', 'Both players must select matching games and be ready.');
    room.stream = { epoch: randomUUID(), hostId: member.id, hostSlot: member.slot, gameHash: member.game!.hash, startedAt: this.now() };
    this.touch(room); this.publish(room);
    return { room: this.snapshot(room) };
  }
  stopStream(socketId: string, epoch: string) {
    const { room } = this.membership(socketId);
    if (!room.stream || room.stream.epoch !== epoch) throw new RoomError('STALE_SESSION', 'This game has ended.');
    this.resetReady(room); this.touch(room); this.publish(room);
  }
  relayStream(socketId: string, data: StreamSignal) {
    const { member, room } = this.membership(socketId);
    if (!room.stream || room.stream.epoch !== data.epoch) throw new RoomError('STALE_SESSION', 'This game has ended.');
    const host = member.id === room.hostId;
    if ((data.signal.type === 'offer' && !host) || (data.signal.type === 'answer' && host)) throw new RoomError('SIGNAL_ROLE', 'Invalid signaling role.');
    const peer = room.members.find(player => player.id !== member.id && player.socketId);
    if (!peer?.socketId) throw new RoomError('PEER_AWAY', 'Your opponent disconnected.');
    this.touch(room);
    return peer.socketId;
  }
  pingStream(socketId: string) {
    this.sweep();
    const member = this.member(socketId);
    const room = member.roomCode ? this.rooms.get(member.roomCode) : undefined;
    if (room?.stream) this.touch(room);
  }
  leave(socketId: string) {
    const { member, room } = this.membership(socketId);
    if (member.id === room.hostId) { this.close(room, 'The host left. This room is closed.'); return; }
    this.removeGuest(room, member); this.touch(room); this.publish(room);
  }
  disconnect(socketId: string) {
    const member = this.sockets.get(socketId);
    if (!member || member.socketId !== socketId) return;
    this.sockets.delete(socketId); member.socketId = null; member.ready = false; member.disconnectedAt = this.now();
    if (!member.roomCode) { this.sessions.delete(member.token); return; }
    const room = this.rooms.get(member.roomCode);
    if (room) { this.resetReady(room); this.publish(room); }
  }
  private removeGuest(room: Room, member: Member) {
    room.members = room.members.filter(player => player.id !== member.id);
    member.roomCode = null; member.game = null; member.ready = false;
    if (!member.socketId) this.sessions.delete(member.token);
    this.resetReady(room);
  }
  private close(room: Room, reason: string) {
    const sockets = room.members.flatMap(member => member.socketId ? [member.socketId] : []);
    this.rooms.delete(room.code);
    for (const member of room.members) {
      member.roomCode = null; member.ready = false; member.game = null;
      if (!member.socketId) this.sessions.delete(member.token);
    }
    this.onClosed(reason, sockets);
  }
  sweep() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const host = room.members.find(member => member.id === room.hostId)!;
      if (now >= Math.min(room.updatedAt + this.idleMs, room.createdAt + this.lifetimeMs) || (!host.socketId && host.disconnectedAt !== null && now - host.disconnectedAt >= this.graceMs)) {
        this.close(room, 'The room expired or its host did not reconnect.'); continue;
      }
      let changed = false;
      for (const member of [...room.members]) {
        if (member.id !== room.hostId && !member.socketId && member.disconnectedAt !== null && now - member.disconnectedAt >= this.graceMs) { this.removeGuest(room, member); changed = true; }
      }
      if (changed) this.publish(room);
    }
  }
}
