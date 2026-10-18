'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import PublicLobbies from './public-lobbies';
import OnlinePlayer from './online-player';
import { ArrowLeftRight, Check, Copy, DoorOpen, Plug, Users } from 'lucide-react';
import { CHANNEL, EMULATOR_PROFILE, codeSchema, tokenSchema, type GameMetadata, type Reply, type RoomSnapshot, type SessionHello } from '@/lib/multiplayer/protocol';
import type { Game } from '@/lib/library';

const STORAGE = 'genesis-room-session';
type Credentials = { token: string; code?: string; inviteToken?: string };
type Connection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';
function credentials(): Credentials | null {
  try { const value = JSON.parse(sessionStorage.getItem(STORAGE) || 'null'); return value && tokenSchema.safeParse(value.token).success ? value : null; }
  catch { return null; }
}
function cleanName(value: string, max: number) { return value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max) || 'Player One'; }
function serviceURL() {
  const configured = process.env.NEXT_PUBLIC_MULTIPLAYER_URL;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const url = new URL(configured || (process.env.NODE_ENV === 'development' || local ? `${location.protocol}//${location.hostname}:4001` : location.origin));
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('The multiplayer service URL must be an HTTP(S) origin.');
  if (location.protocol === 'https:' && url.protocol !== 'https:') throw new Error('The multiplayer service must use HTTPS on this site.');
  return url.origin;
}

export default function OnlineRooms({ games, guest, libraryReady, active, addDemo, demoBusy }: { games: Game[]; guest: string; libraryReady: boolean; active: boolean; addDemo: () => Promise<void>; demoBusy: boolean }) {
  const socket = useRef<Socket | null>(null);
  const [lobbyClient, setLobbyClient] = useState<Socket | null>(null);
  const [mode, setMode] = useState<'private' | 'public'>('private');
  const [connection, setConnection] = useState<Connection>('idle');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [myId, setMyId] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pendingInvite, setPendingInvite] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(location.hash.slice(1));
      if (!params.has('room')) return;
      const roomCode = params.get('room') || '';
      const invite = params.get('invite') || '';
      if (!codeSchema.safeParse(roomCode).success || !tokenSchema.safeParse(invite).success) { setError('This invitation link is invalid. Ask the host for a new link or room code.'); return; }
      setCode(roomCode); setPendingInvite(invite);
      setNotice('Invitation loaded. Connect to multiplayer, then join the room.');
    }, 0);
    return () => { clearTimeout(timer); socket.current?.removeAllListeners(); socket.current?.disconnect(); };
  }, []);

  useEffect(() => {
    if (connection !== 'connected') return;
    const measure = () => {
      const started = performance.now();
      socket.current?.timeout(3000).emit(CHANNEL.ping, {}, (err: Error | null, reply: Reply) => {
        if (!err && reply?.ok) setLatency(Math.round(performance.now() - started));
      });
    };
    measure(); const timer = setInterval(measure, 5000);
    return () => clearInterval(timer);
  }, [connection]);

  function remember(value: Credentials) {
    try { sessionStorage.setItem(STORAGE, JSON.stringify(value)); }
    catch { setNotice('Room joined, but this browser cannot store your reconnect credential. Keep the tab open.'); }
  }
  function connect() {
    socket.current?.removeAllListeners(); socket.current?.disconnect();
    setError(''); setConnection('connecting'); setLatency(null);
    try {
      const saved = credentials();
      const client = io(serviceURL(), { autoConnect: false, transports: ['websocket'], timeout: 5000, reconnectionDelay: 1000, reconnectionDelayMax: 5000, auth: { name: cleanName(guest, 24), ...(saved ? { token: saved.token } : {}) } });
      socket.current = client; setLobbyClient(client);
      let replaced = false;
      client.on('connect', () => setConnection('connected'));
      client.on('session', (hello: SessionHello) => {
        client.auth = { name: cleanName(guest, 24), token: hello.token };
        setMyId(hello.id); setRoom(hello.room);
        const latest = credentials();
        const savedInvite = hello.room?.code === latest?.code ? latest?.inviteToken : undefined;
        setInviteToken(savedInvite || null);
        remember({ token: hello.token, ...(hello.room ? { code: hello.room.code, inviteToken: savedInvite } : {}) });
        if (hello.restored && hello.room) setNotice('Reconnected to the waiting room. Both players need to ready up again.');
        else if (saved && !hello.restored) setNotice('The previous session expired or the service restarted. You can create or join a new room.');
        setError('');
      });
      client.on('room:update', (snapshot: RoomSnapshot) => setRoom(snapshot));
      client.on('room:closed', ({ message }: { message: string }) => { setRoom(null); setInviteToken(null); setNotice(message); });
      client.on('room:error', (message: string) => setError(message));
      client.on('session:replaced', () => {
        replaced = true; client.io.reconnection(false);
        try { sessionStorage.removeItem(STORAGE); } catch { /* Storage may be unavailable. */ }
        setRoom(null); setError('This session was opened in another connection. Connect again to use a new guest session.');
      });
      client.on('disconnect', reason => {
        setLatency(null);
        setRoom(previous => previous ? { ...previous, stream: null, players: previous.players.map(player => ({ ...player, ready: false })) } : null);
        setConnection(replaced || reason === 'io server disconnect' ? 'error' : 'reconnecting');
        if (!replaced) setError('Connection lost. Your slot is reserved for up to 60 seconds. Reconnection will reset readiness.');
      });
      client.on('connect_error', () => { setConnection('error'); setError('The multiplayer service is unavailable or refused the connection. Check the service URL and try again. Local play remains available.'); });
      client.connect();
    } catch (error) { setConnection('error'); setError(error instanceof Error ? error.message : 'Could not connect.'); }
  }

  async function request(event: string, payload: object) {
    const client = socket.current;
    if (!client?.connected) { setError('Connect to the multiplayer service first.'); return; }
    setBusy(true); setError('');
    try {
      const result = await new Promise<Reply>((resolve, reject) => client.timeout(5000).emit(event, payload, (err: Error | null, reply: Reply) => err ? reject(new Error('The request timed out. Reconnect to check the latest room state before trying again.')) : resolve(reply)));
      if (!result.ok) { setError(result.message); return; }
      if (event === CHANNEL.create) setNotice(`${result.room?.visibility === 'public' ? 'Public' : 'Private'} waiting room created.`);
      if (event === CHANNEL.join || event === CHANNEL.joinPublic) setNotice('Joined the waiting room.');
      if (result.room) {
        setRoom(result.room);
        if (result.inviteToken) setInviteToken(result.inviteToken);
        const saved = credentials();
        if (saved) remember({ token: saved.token, code: result.room.code, inviteToken: result.inviteToken || inviteToken || undefined });
      }
      if (event === CHANNEL.leave) { setRoom(null); setInviteToken(null); setNotice('You left the room.'); }
      if (event === CHANNEL.join || event === CHANNEL.joinPublic) { setPendingInvite(undefined); history.replaceState(null, '', location.pathname + location.search); }
    } catch (error) { setError(error instanceof Error ? error.message : 'The request failed.'); }
    finally { setBusy(false); }
  }
  function leave() {
    if (socket.current?.connected) { void request(CHANNEL.leave, {}); return; }
    socket.current?.removeAllListeners(); socket.current?.disconnect(); socket.current = null;
    try { sessionStorage.removeItem(STORAGE); } catch { /* Continue leaving locally if storage is unavailable. */ }
    setRoom(null); setInviteToken(null); setConnection('idle'); setError(''); setLatency(null);
    setNotice('Left locally. The service will release the disconnected slot when its 60-second reconnection window expires.');
  }
  async function copy(invitation: boolean) {
    if (!room) return;
    try {
      let value = room.code;
      if (invitation && inviteToken) {
        const link = new URL(location.pathname, location.origin);
        link.hash = new URLSearchParams({ room: room.code, invite: inviteToken }).toString();
        value = link.href;
      }
      await navigator.clipboard.writeText(value); setNotice(invitation ? 'Invitation link copied.' : 'Room code copied.');
    } catch { setError('Clipboard access is unavailable. Select and copy the room code manually.'); }
  }
  const me = room?.players.find(player => player.id === myId);
  const host = room?.hostId === myId;
  const online = connection === 'connected';
  const canReady = !!room && games.some(game => game.id === me?.game?.hash) && room.compatibility === 'matched' && room.players.every(player => player.connected) && !!me?.game?.multiplayerConfirmed;
  const compatibilityLabel = room?.compatibility === 'matched' ? 'ROM hashes and declared emulator profiles match' : room?.compatibility === 'rom-mismatch' ? 'ROM contents differ. Select matching copies of the game.' : room?.compatibility === 'profile-mismatch' ? 'Emulator profiles differ. Both players need the same app build.' : 'Waiting for both players to select a local game';

  useEffect(() => {
    if (!libraryReady || connection !== 'connected' || !me?.game?.hash || games.some(game => game.id === me.game?.hash)) return;
    socket.current?.timeout(5000).emit(CHANNEL.game, { game: null }, (error: Error | null, reply: Reply) => {
      if (error || !reply?.ok) setError('The selected ROM is no longer in your library. Select an available game after reconnecting.');
    });
  }, [libraryReady, connection, games, me?.game?.hash]);

  const playingGame = games.find(game => game.id === room?.stream?.gameHash);
  return <section className="online-panel rooms-panel">
    {room?.stream && playingGame && lobbyClient && <OnlinePlayer key={room.stream.epoch} game={playingGame} session={room.stream} myId={myId} client={lobbyClient} onEnd={message => { if (message) setNotice(message); void request(CHANNEL.streamStop, {epoch:room.stream!.epoch}); }}/>} 
    <div className="room-intro"><div><span className="hero-tag">ONLINE MULTIPLAYER</span><h2>Bring a friend. Pick a classic.</h2><p>Create a two-player waiting room, match your local ROMs, and choose your controller positions.</p></div><div className={`connection-pill ${online ? 'connected' : ''}`} role="status"><span className={online ? 'green-dot' : 'soon-dot'}/>{connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : connection === 'reconnecting' ? 'Reconnecting…' : 'Disconnected'}{online && latency !== null && <span>{latency} ms RTT</span>}</div></div>
    <div className="notice room-limitation">Casual multiplayer uses host streaming: one emulator, two controller ports. The host shares picture and sound; ROM files stay local. Both players need a compatible two-player game.</div>
    {!room?.stream && <div className="room-demo"><div><strong>Ready for a quick duel?</strong><p>Try our original two-player Genesis game. Press Start, wait for green, then press B first. Early presses lose.</p></div><button className="outline-button" disabled={demoBusy} onClick={() => { void addDemo(); }}>{demoBusy ? 'Adding…' : 'Add free two-player demo'}</button></div>}
    {error && <div className="room-error" role="alert">{error}</div>}
    {notice && <p className="room-notice" role="status">{notice}</p>}
    {!online && <button className="primary-button" onClick={connect} disabled={connection === 'connecting'}><Plug size={16}/>{connection === 'idle' ? 'Connect to multiplayer' : 'Reconnect to multiplayer'}</button>}
    {!room && <div className="room-mode-tabs" role="tablist" aria-label="Room type">{(['private','public'] as const).map(value => <button key={value} role="tab" id={`tab-${value}`} aria-selected={mode === value} aria-controls={`panel-${value}`} onClick={() => {setMode(value);setError('');}}>{value === 'private' ? 'Private Room' : 'Public Lobbies'}</button>)}</div>}
    {!room ? <div role="tabpanel" id={`panel-${mode}`} aria-labelledby={`tab-${mode}`}>{mode === 'public' ? <PublicLobbies client={online ? lobbyClient : null} active={active} games={games} busy={busy} onCreate={game => request(CHANNEL.create,{visibility:'public',game})} onJoin={id => request(CHANNEL.joinPublic,{id})}/> : <div className="mode-grid"><article><Users size={29}/><h3>Private Room</h3><p>Your room, your player two. Share a code or a private invitation link. No account required.</p><button className="primary-button" disabled={!online || busy} onClick={() => request(CHANNEL.create, {})}>Create Room</button></article><article><DoorOpen size={29}/><h3>Join Room</h3><p>Have an invitation? Enter the host’s ten-character room code below.</p><form onSubmit={event => { event.preventDefault(); if (!codeSchema.safeParse(code).success) {setError('Enter a valid ten-character room code.'); return;} void request(CHANNEL.join, { code, ...(pendingInvite ? { inviteToken: pendingInvite } : {}) }); }}><label className="room-code-input">Room Code<input value={code} autoComplete="off" spellCheck={false} maxLength={10} onChange={event => {setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '')); setPendingInvite(undefined);}} placeholder="XXXXXXXXXX"/></label><button className="outline-button" disabled={!online || busy || code.length !== 10}>Join Room</button></form></article></div>}</div> : <>
      <div className="room-code-bar"><div><span className="tiny-label">{room.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'} ROOM · 2 PLAYER CAPACITY</span><strong className="room-code">{room.code}</strong><small>Expires {new Date(room.expiresAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} unless active; maximum two hours.</small></div><div className="room-code-actions"><button className="outline-button" onClick={() => copy(false)}><Copy size={14}/>Copy Room Code</button>{host && inviteToken && <button className="outline-button" onClick={() => copy(true)}><Copy size={14}/>Copy Invitation Link</button>}</div></div>
      <div className="player-slots">{([1,2] as const).map(slot => {
        const player = room.players.find(member => member.slot === slot);
        return <article className={`room-player ${player?.ready ? 'is-ready' : ''}`} key={slot}><div className="room-player-heading"><span className="tiny-label">PLAYER {slot}</span><span className={`ready-indicator ${player?.ready ? 'ready' : ''}`}>{player?.ready ? <><Check size={12}/>Ready</> : 'Not Ready'}</span></div><div className="room-player-name"><span className="avatar">{player ? player.name[0].toUpperCase() : '?'}</span><div><h3>{player?.name || 'Waiting for player…'} {player?.id === myId && <small>(you)</small>}</h3><p>{player ? `${player.id === room.hostId ? 'Host · ' : ''}${player.connected ? 'Connected' : 'Disconnected · slot reserved for reconnection'}` : 'Share the room code with a friend'}</p></div></div><p className="room-game-name">{player?.game?.name || 'No local game selected'}</p>{player?.game && <div className="room-hash" title={player.game.hash}>SHA-256 {player.game.hash.slice(0,16)}… <span>{player.game.multiplayerConfirmed ? 'Two-player mode confirmed by player' : 'Two-player mode unverified'}</span></div>}</article>;
      })}</div>
      <div className={`compatibility-status ${room.compatibility === 'matched' ? 'matched' : ''}`} role="status">{compatibilityLabel}</div>
      {room.players.some(player => !player.connected) && <div className="room-error" role="alert">A player disconnected. Readiness has been cleared. Their slot is reserved for up to 60 seconds.</div>}
      <div className="room-game-picker"><label>Your local game<select disabled={!online || busy || !!room.stream} value={me?.game?.hash || ''} onChange={event => {
        const game = games.find(game => game.id === event.target.value);
        const metadata: GameMetadata | null = game ? { name: cleanName(game.name,120), hash: game.id, profile: EMULATOR_PROFILE, multiplayerConfirmed: false } : null;
        void request(CHANNEL.game, {game:metadata});
      }}><option value="">Select a game from your library</option>{games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label><p>Only the title, SHA-256 hash, emulator profile, and mode confirmation are shared. ROM files stay on your device.</p>{!games.length && <p>Import a Genesis ROM using Import games before selecting it here.</p>}{me?.game && <label className="mode-confirmation"><input type="checkbox" disabled={!online || busy || !!room.stream} checked={me.game.multiplayerConfirmed} onChange={event => request(CHANNEL.game, {game:{...me.game!,multiplayerConfirmed:event.target.checked}})}/>I’ve verified this game supports the intended two-player mode.</label>}</div>
      <div className="room-footer-actions"><button className={me?.ready ? 'outline-button' : 'primary-button'} disabled={!online || busy || !!room.stream || (!me?.ready && !canReady)} onClick={() => request(CHANNEL.ready, {ready:!me?.ready})}>{me?.ready ? 'Not Ready' : 'Ready'}</button>{host && <button className="outline-button" disabled={!online || busy || !!room.stream} onClick={() => request(CHANNEL.swap,{})}><ArrowLeftRight size={14}/>Swap Player 1 / Player 2</button>}<button className="primary-button" disabled={!online || busy || !host || !room.streamAvailable || !!room.stream || room.players.length !== 2 || !room.players.every(player => player.ready && player.connected)} onClick={() => request(CHANNEL.streamStart,{})}>Start Game</button><button className="leave-room-button" disabled={busy} onClick={leave}>Leave Session</button></div>
      {room.players.length === 2 && room.players.every(player => player.ready) && <p className="room-notice">Both players are ready. The host can select Start Game, then Start game inside the emulator.</p>}
    </>}
    {room && !room.streamAvailable && <p className="room-error">Restart the multiplayer service with host streaming enabled to play.</p>}
    {room?.visibility === 'public' && host && !me?.game && <p className="room-notice">Select a local game to make this public room discoverable again.</p>}

  </section>;
}
