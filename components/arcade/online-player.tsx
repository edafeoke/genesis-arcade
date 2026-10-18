'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Expand, X } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { CHANNEL, type Reply, type StreamSession, type StreamSignal } from '@/lib/multiplayer/protocol';
import type { Game } from '@/lib/library';

import { iceServers } from '@/lib/multiplayer/ice';
const PLAYER = 'genesis-player-v1';
const STREAM = 'genesis-stream-v1';
export default function OnlinePlayer({ game, session, myId, client, onEnd, onMedia }: { game: Game; session: StreamSession; myId: string; client: Socket; onEnd: (message?: string) => void; onMedia?: (media: MediaStream | null) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [status, setStatus] = useState('Preparing peer connection…');
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState('');
  const host = session.hostId === myId;
  const endFromConnection = useEffectEvent((message: string) => onEnd(message));
  const mediaChanged = useEffectEvent((media: MediaStream | null) => onMedia?.(media));
  const {epoch,hostSlot} = session;
  const slot = host ? hostSlot : hostSlot === 1 ? 2 : 1;
  useEffect(() => {
    let initialized = false, loaded = false, ended = false;
    const pending: StreamSignal[] = [];
    const send = (type: string, value: object = {}) => frame.current?.contentWindow?.postMessage({ channel: STREAM, type, ...value }, location.origin);
    const fail = (message: string) => { if (ended) return; ended = true; setError(message); send('stop'); endFromConnection(message); };
    const relay = (value: StreamSignal) => {
      if (value.epoch !== epoch || ended) return;
      if (!initialized) { if (pending.length < 100) pending.push(value); else fail('Too many queued connection messages.'); return; }
      send('signal', { signal: value.signal });
    };
    const listener = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (message?.channel === PLAYER && message.type === 'bridge-ready' && host && !loaded) {
        loaded = true;
        frame.current?.contentWindow?.postMessage({ channel: PLAYER, type: 'load', rom: game.rom, id: game.id }, location.origin);
      }
      if (message?.channel === PLAYER && message.type === 'error') fail(message.message || 'The host emulator could not start.');
      if (message?.channel !== STREAM) return;
      if (message.type === 'ready') {
        try { send('init', { config: { epoch: epoch, host, hostSlot: hostSlot, iceServers: iceServers() } }); }
        catch { fail('The multiplayer ICE server configuration is invalid.'); }
      }
      if (message.type === 'media-ready' && host) mediaChanged((frame.current?.contentWindow as (Window & {genesisSpectatorMedia?: MediaStream}) | null)?.genesisSpectatorMedia ?? null);
      if (message.type === 'initialized') { initialized = true; pending.splice(0).forEach(relay); }
      if (message.type === 'status' && typeof message.message === 'string') setStatus(message.message.slice(0, 240));
      if (message.type === 'latency' && Number.isFinite(message.milliseconds)) setLatency(message.milliseconds);
      if (message.type === 'signal') client.timeout(5000).emit(CHANNEL.signal, { epoch: epoch, signal: message.signal }, (err: Error | null, reply: Reply) => {
        if (err || !reply?.ok) fail(err ? 'Signaling timed out.' : !reply.ok ? reply.message : 'Signaling failed.');
      });
      if (message.type === 'ended') fail(message.message || 'The game connection ended.');
    };
    const disconnect = () => fail('Room service disconnected. Controls have been released. Return to the waiting room.');
    client.on(CHANNEL.signal, relay); client.on('disconnect', disconnect);
    window.addEventListener('message', listener);
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      mediaChanged(null); send('stop'); window.removeEventListener('message', listener);
      client.off(CHANNEL.signal, relay); client.off('disconnect', disconnect);
      document.body.style.overflow = previousOverflow; previousFocus?.focus();
    };
  }, [client, game, host, epoch, hostSlot, myId]);
  return <div className="player-backdrop"><section ref={panel} tabIndex={-1} className="player-panel" role="dialog" aria-modal="true" aria-labelledby="online-player-title" onKeyDown={event => {
    if (event.key === 'Escape' && !document.fullscreenElement) onEnd();
    if (event.key === 'Tab') {
      const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), iframe');
      const first = elements?.[0], last = elements?.[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="player-heading"><div><span className="tiny-label">ONLINE · PLAYER {slot} · {host ? 'HOST' : 'GUEST'}</span><h2 id="online-player-title">{game.name}</h2></div><div className="player-actions"><button aria-label="Enter fullscreen" onClick={() => { void panel.current?.requestFullscreen().catch(() => setError('Fullscreen unavailable. Continue in this window.')); }}><Expand size={18}/></button><button aria-label="End online game" onClick={() => onEnd()}><X size={20}/></button></div></header>
    <div className="player-status" role="status">{status}{latency !== null && ` · ${latency} ms input round trip`}</div>
    {error && <div className="notice" role="alert">{error} <button className="outline-button" onClick={() => onEnd()}>Return to waiting room</button></div>}
    <iframe ref={frame} className="emulator-frame online-emulator-frame" src="/online-player/index.html" title={`${host ? 'Host' : 'Guest'} online game`} allow="autoplay; fullscreen; gamepad" onLoad={() => {
      frame.current?.contentWindow?.postMessage({ channel: STREAM, type: 'ping' }, location.origin);
      frame.current?.contentWindow?.postMessage({ channel: PLAYER, type: 'ping' }, location.origin);
    }}/>
    <div className="player-help"><p>Click the game to focus. Arrows: move · A/S/D: A/B/C · Q/W/E: X/Y/Z · Enter: Start · Right Shift: Mode. Open Remap controller below the game to change and save your keys or standard gamepad buttons. On-screen buttons also work.</p></div>
    <p className="player-save-note">The host runs the game and streams picture and sound. Input delay depends on your connection. End Game returns both players to the waiting room.</p>
  </section></div>;
}
