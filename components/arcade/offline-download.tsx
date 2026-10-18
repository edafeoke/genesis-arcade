'use client';

import { useEffect, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';

type OfflineStatus = 'idle' | 'downloading' | 'ready' | 'error';
async function packageReady(worker: ServiceWorker, expectedVersion?: string): Promise<boolean> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.ready === true && (!expectedVersion || event.data.version === expectedVersion)); };
    worker.postMessage({ type: 'STATUS' }, [channel.port2]);
  });
}
function waitForActivation(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    if (worker.state === 'activated') { resolve(); return; }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Download timed out. Check your connection and available storage, then retry.')); }, 90_000);
    const update = () => {
      if (worker.state === 'activated') { cleanup(); resolve(); }
      if (worker.state === 'redundant') { cleanup(); reject(new Error('Offline download failed. Check your connection and browser storage, then retry.')); }
    };
    function cleanup() { clearTimeout(timer); worker.removeEventListener('statechange', update); }
    worker.addEventListener('statechange', update);
    update();
  });
}

export default function OfflineDownload() {
  const [status, setStatus] = useState<OfflineStatus>('idle');
  const [message, setMessage] = useState('Download the app and emulator once, then keep playing your local games without a connection.');
  const production = process.env.NODE_ENV === 'production';

  useEffect(() => {
    if (!production || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker.getRegistration('/').then(async registration => {
      if (registration?.active && await packageReady(registration.active) && !cancelled) {
        setStatus('ready');
        setMessage('This browser has an offline package. Download again after updating the app.');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [production]);

  async function download() {
    setStatus('downloading');
    setMessage('Downloading the app and Genesis runtime. Keep this tab open…');
    try {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) throw new Error('Offline downloads require HTTPS or localhost and a browser with service worker support.');
      const build = await fetch('/offline-build.json', { cache: 'no-store' });
      if (!build.ok) throw new Error('No offline package is available. Run a production build first.');
      const { version } = await build.json() as { version: string };
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (registration.active && !registration.installing) await registration.update();
      const worker = registration.installing || registration.waiting || registration.active;
      if (!worker) throw new Error('The offline download could not start. Retry.');
      await waitForActivation(worker);
      if (!await packageReady(worker, version)) throw new Error('Some offline files are missing. Clear this site’s offline cache and download again.');
      setStatus('ready');
      setMessage('Offline package is ready in this browser. ROMs and emulator saves remain on this device.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Offline download failed. Retry when connected.');
    }
  }

  return <div className="offline-download"><div><span className="tiny-label">TAKE YOUR ARCADE OFFLINE</span><h3>{status === 'ready' ? 'Offline package ready' : 'Play beyond the connection.'}</h3><p role="status">{production ? message : 'Offline downloads are available in a production build. Development mode always needs the local dev server.'}</p></div><button className="outline-button" disabled={!production || status === 'downloading'} onClick={download}>{status === 'ready' ? <ShieldCheck size={16}/> : <Download size={16}/>} {status === 'downloading' ? 'Downloading…' : status === 'ready' ? 'Refresh download' : 'Download for offline'}</button></div>;
}
