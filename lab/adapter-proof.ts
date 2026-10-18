import { ADAPTER_VERSION, VersionedEmulatorAdapter } from '../lib/emulation/adapter';
import { FRAME_FIXTURE_SHA256, FixtureEmulatorBackend, type FixtureManager } from '../lib/emulation/fixture-backend';

declare global {
  interface Window {
    genesisAdapterProof?: (frames: number) => Promise<unknown>;
    EJS_gameName: string;
    EJS_emulator: { gameManager: FixtureManager; getCoreSettings(): string };
  }
}
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
if (new URLSearchParams(location.search).get('adapter') === '1') {
  window.genesisAdapterProof = async frames => {
    if (window.EJS_gameName !== FRAME_FIXTURE_SHA256) return { available: false, reason: 'Exact frame diagnostic ROM required.' };
    if (![16, 120].includes(frames)) throw new Error('Unsupported diagnostic trace length.');
    const provenanceResponse = await fetch('/sync-lab/runtime/provenance.json', { cache: 'no-store' });
    if (!provenanceResponse.ok) throw new Error('Build the instrumented lab runtime first.');
    const provenance = await provenanceResponse.json();
    const emulator = window.EJS_emulator;
    const backend = new FixtureEmulatorBackend(emulator.gameManager, window.EJS_gameName);
    const adapter = new VersionedEmulatorAdapter({ adapter: ADAPTER_VERSION, rom: window.EJS_gameName,
      core: provenance.instrumentedArchiveSHA256,
      runtime: await hash(new TextEncoder().encode(JSON.stringify(provenance))),
      settings: await hash(new TextEncoder().encode(emulator.getCoreSettings())),
    }, backend, { allowFixtureOnly: true });
    const checkpoint = await adapter.capture();
    const trace = async () => {
      const hashes: string[] = [];
      for (let frame = 0; frame < frames; frame++) {
        await adapter.step(frame, [frame < frames / 2 ? 16 : 0, frame >= frames / 2 ? 16 : 0]);
        hashes.push((await adapter.capture()).checksum);
      }
      return hashes;
    };
    try {
      const first = await trace();
      await adapter.restore(checkpoint);
      const replay = await trace();
      const mismatch = first.findIndex((value, index) => value !== replay[index]);
      return { scope: 'local diagnostic adapter replay; no network transport', identity: adapter.identity,
        frames, checkpointChecksum: checkpoint.checksum, allStepsEqual: mismatch === -1,
        firstDivergentStep: mismatch < 0 ? null : mismatch + 1, stepChecksums: first, replayChecksums: replay };
    } finally { await adapter.releaseInputs(); }
  };
}
