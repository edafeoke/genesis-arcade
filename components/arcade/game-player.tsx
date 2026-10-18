'use client';

import { useEffect, useRef, useState } from 'react';
import { Expand, Gamepad2, RotateCcw, X } from 'lucide-react';
import type { Game } from '@/lib/library';

const CHANNEL = 'genesis-player-v1';
type Status = 'loading' | 'ready' | 'playing' | 'error';

export default function GamePlayer({ game, onClose }: { game: Game; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = () => {
      setStatus('error');
      setError('The player took too long to load. Retry, or check your browser’s WebAssembly and graphics support.');
    };
    timer = setTimeout(timeout, 30_000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== CHANNEL) return;
      switch (event.data.type) {
        case 'bridge-ready':
          frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type: 'load', rom: game.rom, id: game.id }, location.origin);
          break;
        case 'ready':
          clearTimeout(timer);
          setStatus('ready');
          break;
        case 'starting':
          clearTimeout(timer);
          timer = setTimeout(timeout, 60_000);
          setStatus('loading');
          break;
        case 'started':
          clearTimeout(timer);
          setStatus('playing');
          frame.current?.focus();
          break;
        case 'error':
          clearTimeout(timer);
          setStatus('error');
          setError(typeof event.data.message === 'string' ? event.data.message.slice(0, 240) : 'The game could not start.');
          break;
      }
    };
    window.addEventListener('message', receive);
    return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [game, attempt]);

  function retry() { setStatus('loading'); setError(''); setAttempt(value => value + 1); }
  async function fullscreen() {
    try { await panel.current?.requestFullscreen(); }
    catch { setError('Fullscreen is unavailable in this browser. You can continue playing in this window.'); }
  }

  return <div className="player-backdrop">
    <section ref={panel} className="player-panel" role="dialog" aria-modal="true" aria-labelledby="player-title" onKeyDown={event => {
      if (event.key === 'Escape' && !document.fullscreenElement) onClose();
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), iframe');
        const first = elements?.[0];
        const last = elements?.[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="player-heading"><div><span className="tiny-label">SINGLE PLAYER · SEGA GENESIS</span><h2 id="player-title">{game.name}</h2></div><div className="player-actions"><button onClick={fullscreen} aria-label="Enter fullscreen"><Expand size={18}/></button><button onClick={retry} aria-label="Restart game"><RotateCcw size={18}/></button><button ref={closeButton} onClick={onClose} aria-label="Close player"><X size={20}/></button></div></header>
      <div className="player-status" role="status"><span className={status === 'error' ? 'error-dot' : 'green-dot'}/>{status === 'loading' ? 'Loading local emulator…' : status === 'ready' ? 'Ready — select Start game in the player' : status === 'playing' ? 'Playing locally' : 'Unable to start'}</div>
      {error && <div className="notice" role="alert">{error}{status === 'error' && <button className="outline-button" onClick={retry}>Retry</button>}</div>}
      {status !== 'error' && <iframe key={attempt} ref={frame} className="emulator-frame" src="/player/index.html" title={`${game.name} — Genesis player`} onLoad={() => frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type: 'ping' }, location.origin)} allow="autoplay; fullscreen; gamepad" onError={() => {setStatus('error'); setError('The player page is unavailable. Reconnect and try again.');}}/>}
      <div className="player-help"><Gamepad2 size={18}/><p>Click the game to focus controls. Use the player’s controller settings to view or remap keyboard and gamepad buttons. Save/load state controls are in its toolbar.</p></div>
      <p className="player-save-note">Save before closing. Emulator save data stays in this browser; export important saves using the player settings.</p>
    </section>
  </div>;
}
