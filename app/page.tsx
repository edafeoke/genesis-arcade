'use client';

import Link from 'next/link';
import GamePlayer from '@/components/arcade/game-player';
import OfflineDownload from '@/components/arcade/offline-download';
import OnlineRooms from '@/components/arcade/online-rooms';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, Cpu, Gamepad2, Globe2, HardDrive, Library, Plus, Search, ShieldCheck, Star, Trash2, Users, X, Zap } from 'lucide-react';
import { Game, importGame, listGames, removeGame, saveGame } from '@/lib/library';

type View = 'library' | 'favorites' | 'online' | 'settings';
export default function Home() {
  const [view, setView] = useState<View>('library');
  const [games, setGames] = useState<Game[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Game | null>(null);
  const [playing, setPlaying] = useState<Game | null>(null);
  const [guest, setGuest] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    listGames().then(setGames).catch(() => setMessage('Your library could not be opened. Check browser storage permissions.')).finally(() => setLoading(false));
    const timer = window.setTimeout(() => {
      try {
        if (!localStorage.getItem('genesis-guest')) localStorage.setItem('genesis-guest', crypto.randomUUID());
        setGuest(localStorage.getItem('genesis-name') || 'Player One');
        if (new URLSearchParams(location.hash.slice(1)).has('room')) setView('online');
      } catch { setMessage('Guest preferences cannot be saved in this browser.'); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function addFiles(files: FileList | null) {
    if (!files || busy) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) await importGame(file);
      setGames(await listGames());
      setMessage('Games added to your local library. Duplicate ROMs are kept only once.');
    } catch (error) {
      setGames(await listGames().catch(() => []));
      setMessage(error instanceof Error ? error.message : 'Import failed. Your browser storage may be full.');
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function favorite(game: Game) {
    try { await saveGame({ ...game, favorite: !game.favorite }); setGames(await listGames()); }
    catch { setMessage('Could not update this game.'); }
  }
  async function addDemo() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/demos/Quickdraw%20Duel.bin');
      if (!response.ok) throw new Error('The demo is unavailable. Try again while online.');
      await importGame(new File([await response.arrayBuffer()], 'Quickdraw Duel.bin'));
      setGames(await listGames());
      setMessage('Quickdraw Duel added. Both players can add this original two-player demo. Press Start, wait for green, then press B first.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add the demo.'); }
    finally { setBusy(false); }
  }
  async function remove(game: Game) {
    if (!window.confirm(`Remove ${game.name} from this browser?`)) return;
    try { await removeGame(game.id); setGames(await listGames()); setSelected(null); }
    catch { setMessage('Could not remove this game.'); }
  }
  const filtered = games.filter(game => (view !== 'favorites' || game.favorite) && game.name.toLowerCase().includes(query.toLowerCase()));
  const totalMB = (games.reduce((sum, game) => sum + game.size, 0) / 1048576).toFixed(1);
  return <div className="arcade-shell">
    <aside className="sidebar" inert={!!playing}>
      <Link className="brand" href="/" aria-label="Genesis Arcade home"><span className="brand-icon"><Gamepad2 size={23}/></span><span>GENESIS<span className="brand-sub">ARCADE</span></span></Link>
      <div className="nav-caption">YOUR PLAYGROUND</div>
      <nav>{([{id:'library', label:'Game library', icon:Library}, {id:'favorites', label:'Favorites', icon:Star}, {id:'online', label:'Play online', icon:Globe2}] as const).map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => {setView(item.id); setQuery('');}}><item.icon size={18}/>{item.label}{item.id === 'library' && <span className="nav-count">{games.length}</span>}{item.id === 'online' && <span className="soon-dot"/>}</button>)}<button className={`nav-item mobile-settings ${view === 'settings' ? 'active' : ''}`} aria-label="Settings" onClick={() => setView('settings')}><Cpu size={18}/></button></nav>
      <div className="sidebar-note"><span className="tiny-label"><Zap size={14}/> THE CLASSICS. RECONNECTED.</span><p>Same legendary games.<br/>A whole new way to play.</p><span className="console-chip">16-BIT / SEGA GENESIS</span></div>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Cpu size={18}/> Settings</button><div className="guest"><span className="avatar">{guest.slice(0,1) || 'P'}</span><div><strong>{guest || 'Player One'}</strong><small>Local guest profile</small></div><span className="green-dot"/></div></div>
    </aside>
    <div className="workspace" inert={!!playing}>
      <header className="topbar"><div className="breadcrumb">Your arcade <ChevronRight size={14}/><span>{view === 'online' ? 'Play online' : view === 'settings' ? 'Settings' : view === 'favorites' ? 'Favorites' : 'Game library'}</span></div><span className="local-status"><span className="green-dot"/> Local-first gaming</span></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">INSERT A LITTLE NOSTALGIA</div><h1>{view === 'online' ? 'Better with a second player.' : view === 'settings' ? 'Make yourself at home.' : view === 'favorites' ? 'The ones you come back to.' : 'Your games. Your arcade.'}</h1><p>{view === 'online' ? 'A new home for old-school co-op and friendly rivalries.' : 'The 16-bit era, right where you left it. Pick up and play.'}</p></div><button className="primary-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={17}/>{busy ? 'Importing…' : 'Import games'}</button></div>
        <input ref={input} type="file" accept=".md,.gen,.bin" multiple hidden onChange={event => addFiles(event.target.files)}/>
        {message && <div className="notice" role="status">{message}<button aria-label="Dismiss notification" onClick={() => setMessage('')}><X size={16}/></button></div>}
        {(view === 'library' || view === 'favorites') && <>
          <section className="hero"><div className="hero-grid"/><div className="hero-copy"><span className="hero-tag"><span/> YOUR NEXT HIGH SCORE AWAITS</span><h2>Great games.<br/>Never get old.</h2><p>Build your own collection of Genesis classics.<br/>Stored in your browser. Always yours to play.</p><button className="light-button" onClick={() => input.current?.click()} disabled={busy}>Build your library <ArrowRight size={16}/></button><div className="hero-foot"><ShieldCheck size={14}/> No accounts. No ROM uploads. Just play.</div></div><div className="console-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="art-label">EST. 1988 / REIMAGINED</span><div className="cartridge"><span>GENESIS</span><div className="cartridge-label"><i>16</i><b>BIT</b><small>THE GOLDEN ERA</small></div><div className="cartridge-teeth"/></div><div className="controller"><div className="dpad"/><span className="controller-brand">GENESIS</span><div className="controller-buttons"><i>C</i><i>B</i><i>A</i></div><span className="start-key"/></div><span className="art-caption">A LITTLE BIT OF LEGEND.</span></div></section>
          <div className="stats"><div><span className="stat-icon"><Library size={19}/></span><strong>{games.length}<small>Games in your library</small></strong></div><div><span className="stat-icon"><Star size={19}/></span><strong>{games.filter(game => game.favorite).length}<small>All-time favorites</small></strong></div><div><span className="stat-icon"><HardDrive size={19}/></span><strong>{totalMB}<em> MB</em><small>Stored on this device</small></strong></div></div>
          <section className="library-section"><div className="section-heading"><div><h2>{view === 'favorites' ? 'Your favorites' : 'Your collection'} <span>{filtered.length}</span></h2><p>A little nostalgia, a lot of possibility.</p></div><label className="search"><Search size={16}/><input aria-label="Search your games" placeholder="Search your games…" value={query} onChange={e => setQuery(e.target.value)}/><kbd>⌕</kbd></label></div>
          {loading ? <div className="empty-state">Opening your local library…</div> : filtered.length ? <div className="game-grid">{filtered.map((game, index) => <article className="game-card" key={game.id}><button className={`game-art art-${index % 4}`} onClick={() => setSelected(game)} aria-label={`View ${game.name}`}><span className="game-platform">SEGA GENESIS</span><Gamepad2 size={65} strokeWidth={1}/><span className="game-monogram">{game.name.slice(0,2).toUpperCase()}</span><span className="game-open">View game <ArrowRight size={16}/></span></button><div className="game-info"><button onClick={() => setSelected(game)}><h3>{game.name}</h3><span>16-bit · {(game.size / 1048576).toFixed(1)} MB</span></button><button className={game.favorite ? 'favorited' : ''} onClick={() => favorite(game)} aria-label={`${game.favorite ? 'Unfavorite' : 'Favorite'} ${game.name}`}><Star size={18} fill={game.favorite ? 'currentColor' : 'none'}/></button></div></article>)}<button className="add-card" onClick={() => input.current?.click()} disabled={busy}><Plus size={27}/><strong>Add to the collection</strong><span>Import a Genesis ROM</span></button></div> : <div className="empty-state" onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault(); void addFiles(e.dataTransfer.files);}}><div className="empty-icon"><Gamepad2 size={31}/><span>+</span></div><h3>{query ? 'No games found' : view === 'favorites' ? 'Your greatest hits go here' : 'Every great arcade starts somewhere.'}</h3><p>{query ? 'Try a different game title.' : view === 'favorites' ? 'Tap the star on a game to keep it close.' : 'Drop your Genesis ROMs here, or import your first game.'}</p>{view === 'library' && !query && <button className="outline-button" onClick={() => input.current?.click()} disabled={busy}><Plus size={16}/> Import your first game</button>}<small>.MD, .GEN, .BIN · UP TO 32 MB EACH</small></div>}</section>
          <section className="online-teaser"><span className="teaser-icon"><Users size={25}/></span><div><span className="tiny-label">GOOD TIMES ARE BETTER TOGETHER</span><h3>Player two is ready.</h3><p>Private rooms. Public lobbies. Your favorite two-player classics.</p></div><button className="outline-button" onClick={() => setView('online')}>Explore multiplayer <ArrowRight size={16}/></button></section>
        </>}
        <div hidden={view !== 'online'}><OnlineRooms games={games} guest={guest} libraryReady={!loading} active={view === 'online'} addDemo={addDemo} demoBusy={busy}/></div>
        {view === 'settings' && <section className="settings-panel"><h2>Your guest profile</h2><p>Your identity stays in this browser. No registration needed.</p><label>Display name<input maxLength={24} value={guest} onChange={e => {setGuest(e.target.value); try { localStorage.setItem('genesis-name', e.target.value); } catch { setMessage('Could not save your display name.'); }}}/></label><div className="settings-row"><ShieldCheck size={22}/><div><strong>Local by design</strong><p>Your ROMs and metadata are stored in IndexedDB on this device. Clearing browser data removes them.</p></div></div><div className="settings-row"><HardDrive size={22}/><div><strong>{totalMB} MB in your library</strong><p>Prepare an offline download below to keep the app and Genesis emulator available without a connection. Browser storage can still be cleared or evicted.</p></div></div><OfflineDownload/></section>}
        <footer><span className="footer-brand"><Gamepad2 size={15}/> GENESIS ARCADE</span><span>Made for the love of the game.</span><span><span className="green-dot"/> ROMs stay on your device</span></footer>
      </main>
    </div>
    {playing && <GamePlayer game={playing} onClose={() => setPlaying(null)}/>}
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="game-modal" role="dialog" aria-modal="true" aria-labelledby="game-title" onClick={e => e.stopPropagation()} onKeyDown={e => {if(e.key === 'Escape') setSelected(null);}} tabIndex={-1} ref={el => el?.focus()}><button className="modal-close" aria-label="Close game details" onClick={() => setSelected(null)}><X/></button><span className="hero-tag">LOCAL LIBRARY</span><h2 id="game-title">{selected.name}</h2><p><Check size={16}/> ROM stored on this device</p><dl><dt>File</dt><dd>{selected.filename}</dd><dt>Size</dt><dd>{(selected.size / 1048576).toFixed(2)} MB</dd><dt>SHA-256</dt><dd className="hash">{selected.id}</dd></dl><button className="primary-button play-local-button" onClick={() => { setPlaying(selected); setSelected(null); }}><Gamepad2 size={17}/> Play locally</button><button className="outline-button" onClick={() => {const url = URL.createObjectURL(selected.rom); const link = document.createElement('a'); link.href = url; link.download = selected.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);}}><ArrowDownToLine size={16}/> Export ROM</button><button className="delete-button" onClick={() => remove(selected)}><Trash2 size={16}/> Remove from library</button></section></div>}
  </div>;
}
