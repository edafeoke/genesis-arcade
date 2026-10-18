'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { ArrowLeft, ArrowRight, Globe2, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { CHANNEL, EMULATOR_PROFILE, LOBBY_PAGE_SIZE, type GameMetadata, type PublicLobby, type Reply } from '@/lib/multiplayer/protocol';
import type { Game } from '@/lib/library';

type Props = {
  client: Socket | null; active: boolean; games: Game[]; busy: boolean;
  onCreate: (game: GameMetadata) => Promise<void>; onJoin: (id: string) => Promise<void>; onWatch: (id: string) => Promise<void>;
};
export default function PublicLobbies({client, active, games, busy, onCreate, onJoin, onWatch}: Props) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [lobbies, setLobbies] = useState<PublicLobby[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (!client || !active) return;
    let disposed = false;
    let pending = false;
    const load = (quiet = false) => {
      if (pending || !client.connected) return;
      pending = true;
      if (!quiet) setLoading(true);
      client.timeout(5000).emit(CHANNEL.list, {query, offset}, (failure: Error | null, reply: Reply) => {
        pending = false;
        if (disposed) return;
        setLoading(false);
        if (failure || !reply?.ok || !reply.lobbies || reply.total === undefined) {
          setError(failure ? 'Lobby discovery timed out. Check your connection and retry.' : reply && !reply.ok ? reply.message : 'The lobby list could not be loaded.');
          return;
        }
        if (offset > 0 && offset >= reply.total) {
          setOffset(Math.max(0, Math.floor((reply.total - 1) / LOBBY_PAGE_SIZE) * LOBBY_PAGE_SIZE));
          setLoading(true); return;
        }
        setLobbies(reply.lobbies); setTotal(reply.total); setError('');
      });
    };
    const initial = setTimeout(() => load(), 200);
    const interval = setInterval(() => load(true), 5000);
    return () => { disposed = true; clearTimeout(initial); clearInterval(interval); };
  }, [client, active, query, offset, refresh]);

  const game = games.find(game => game.id === selected);
  return <section className="lobby-browser" aria-label="Public lobbies">
    <div className="public-create"><div><span className="tiny-label">OPEN THE DOOR TO PLAYER TWO</span><h3>Create a public room</h3><p>Choose your local game. Its title, room occupancy, and readiness will be visible in discovery.</p></div><form onSubmit={event => {
      event.preventDefault();
      if (!game) return;
      void onCreate({name: game.name.replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,120) || 'Untitled game', hash:game.id, profile:EMULATOR_PROFILE, multiplayerConfirmed:false});
    }}><label>Game to host<select aria-label="Game to host" value={selected} disabled={!client || busy} onChange={event => setSelected(event.target.value)}><option value="">Select a local game</option>{games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label><button className="primary-button" disabled={!client || busy || !game}><Plus size={15}/>Create Public Room</button></form>{!games.length && <p>Import a Genesis ROM first to host a public room.</p>}</div>
    <div className="lobby-toolbar"><div><h3>Public Lobbies <span>{client && !loading && !error ? total : '—'}</span></h3><p>Find a waiting room. Join as a player, or watch without a ROM. Hosts can offer games directly to player two.</p></div><div className="lobby-filter"><label className="search"><Search size={15}/><input aria-label="Filter public rooms by game" placeholder="Filter by game…" maxLength={80} value={query} onChange={event => {setQuery(event.target.value);setOffset(0);setLoading(true);}}/></label><button className="outline-button" aria-label="Refresh public lobbies" disabled={!client || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/></button></div></div>
    <div aria-live="polite" aria-busy={!!client && loading}>
      {!client ? <div className="lobby-empty"><Globe2 size={28}/><h4>Connect to discover public rooms.</h4><p>Your local library is available while the room service is offline.</p></div> : error ? <div className="room-error" role="alert">{error}<button className="outline-button" onClick={() => setRefresh(value => value + 1)}>Retry discovery</button></div> : loading ? <div className="lobby-empty" role="status">Loading public rooms…</div> : !lobbies.length ? <div className="lobby-empty"><Users size={28}/><h4>{query ? 'No rooms match this game.' : 'The lobby is quiet. Make the first move.'}</h4><p>{query ? 'Try another title or clear the filter.' : 'Create a public room and let player two find you.'}</p></div> : <div className="lobby-list">{lobbies.map(lobby => <article className="lobby-card" key={lobby.id}><span className="lobby-game-icon"><Globe2 size={22}/></span><div className="lobby-game"><h4>{lobby.gameName}</h4><p>{lobby.status === 'waiting' ? 'Host waiting for player two' : lobby.status === 'host-away' ? 'Host reconnecting' : 'Room full · includes reserved slots'}</p><span>{lobby.modeConfirmed ? 'Two-player mode confirmed by host' : 'Two-player mode unverified'}</span></div><div className="lobby-occupancy"><strong>{lobby.players}/{lobby.capacity} players</strong><small>{lobby.readyPlayers}/{lobby.players} ready · {lobby.spectators || 0}/4 watching</small></div><button className="outline-button" disabled={busy || lobby.status !== 'waiting'} onClick={() => void onJoin(lobby.id).then(() => setRefresh(value => value + 1))}>{lobby.status === 'waiting' ? 'Join Room' : lobby.status === 'full' ? 'Full' : 'Unavailable'}{lobby.status === 'waiting' && <ArrowRight size={14}/>}</button><button className="outline-button" disabled={busy || lobby.status==='host-away' || lobby.spectators>=lobby.spectatorCapacity} onClick={()=>void onWatch(lobby.id)}>Watch</button></article>)}</div>}
    </div>
    {client && !error && total > LOBBY_PAGE_SIZE && <div className="lobby-pagination"><button className="outline-button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0,value - LOBBY_PAGE_SIZE))}><ArrowLeft size={14}/>Previous</button><span>Rooms {Math.min(offset + 1,total)}–{Math.min(offset + LOBBY_PAGE_SIZE,total)} of {total}</span><button className="outline-button" disabled={loading || offset + LOBBY_PAGE_SIZE >= total} onClick={() => setOffset(value => value + LOBBY_PAGE_SIZE)}>Next<ArrowRight size={14}/></button></div>}
    <p className="lobby-privacy">Discovery shows public rooms only. Private codes, invitations, player identities, and ROM hashes are never included. Lists refresh every five seconds while visible.</p>
  </section>;
}
