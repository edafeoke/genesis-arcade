(() => {
  const playerChannel = 'genesis-player-v1';
  const labChannel = 'genesis-capability-lab-v1';
  const status = document.querySelector('#status');
  const probe = document.querySelector('#probe');
  const download = document.querySelector('#download');
  const input = document.querySelector('#rom');
  const traceLength = document.querySelector('#trace-length');
  let clients = [];
  let report;
  let requestId = 0;
  const adapterMode = new URLSearchParams(location.search).get('adapter') === '1';
  let adapterProvenance;
  const pending = new Map();
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    const client = clients.find(item => item.frame.contentWindow === event.source);
    if (!client) return;
    const data = event.data;
    if (data?.channel === playerChannel) {
      if (data.type === 'bridge-ready' && !client.loaded) {
        client.loaded = true;
        client.frame.contentWindow.postMessage({ channel: playerChannel, type: 'load', rom: client.rom, id: client.hash }, location.origin);
      }
      if (data.type === 'started') client.started = true;
      if (data.type === 'error') { client.started = false; status.textContent = data.message; }
      probe.disabled = clients.length !== 2 || !clients.every(item => item.started);
    }
    if (data?.channel === labChannel) {
      const request = pending.get(data.id);
      if (!request || request.client !== client) return;
      clearTimeout(request.timer);
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
    }
  });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.size || file.size > 32 * 1024 * 1024) { status.textContent = 'Select an uncompressed ROM up to 32 MB.'; return; }
    input.disabled = true;
    probe.disabled = true;
    download.disabled = true;
    report = undefined;
    document.querySelector('#results').replaceChildren();
    clients.forEach(client => client.frame.remove());
    clients = [];
    try {
      if (adapterMode) {
        const response = await fetch('/sync-lab/runtime/provenance.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('Run pnpm lab:build and restart the app server before testing the adapter.');
        adapterProvenance = await response.json();
      }
      const hash = await digest(await file.arrayBuffer());
      for (const name of ['a', 'b']) {
        const frame = document.createElement('iframe');
        frame.title = `Genesis runtime ${name.toUpperCase()}`;
        frame.allow = 'autoplay; gamepad';
        frame.src = adapterMode ? '/sync-lab/runtime/player.html?lab=1&adapter=1' : '/player/index.html?lab=1';
        clients.push({ frame, hash, rom: file, started: false, loaded: false });
        document.querySelector(`#runtime-${name}`).append(frame);
      }
      status.textContent = 'Start game in both runtimes, then run the probe.';
    } catch (error) { status.textContent = error.message || 'The local ROM could not be read.'; }
    finally { input.disabled = false; }
  });
  const run = client => new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Probe timed out. Restart both runtimes.')); }, adapterMode ? 120000 : 45000);
    pending.set(id, { client, resolve, reject, timer });
    client.frame.contentWindow.postMessage({ channel: labChannel, type: 'probe', id, frames: Number(traceLength.value) }, location.origin);
  });
  probe.addEventListener('click', async () => {
    probe.disabled = true;
    input.disabled = true;
    traceLength.disabled = true;
    download.disabled = true;
    status.textContent = 'Measuring paused state and a save/load round trip…';
    try {
      const results = await Promise.all(clients.map(run));
      report = { measuredAt: new Date().toISOString(), userAgent: navigator.userAgent, romHash: clients[0].hash,
        profile: 'ejs4.2.3:genesis-plus-gx2.0.2:legacy:single-thread:v1', adapterMode, ...(adapterMode ? { adapterProvenance } : {}),
        scope: 'Two runtimes on one browser; no synchronized input trace, exact frame step, cross-device or rollback verification.', results };
      const table = document.createElement('table');
      const rows = [['Measurement', 'Runtime A', 'Runtime B'], ...[
        ['States supported', 'supportsStates'], ['Pause holds frame counter', 'pausedCounterStable'],
        ['Paused serialization repeats', 'pausedSerializationStable'], ['Resume advances counter', 'resumeAdvanced'],
        ['Immediate restore equals baseline', 'immediateRestoreEqual'], ['Exact frame step verified', 'exactFrameStepVerified'],
        ['Serialized bytes', 'stateBytes'], ['Baseline frame', 'frame'], ['Frame after resume', 'advancedFrame'],
      ].map(([label, key]) => [label, ...results.map(result => typeof result[key] === 'boolean' ? (result[key] ? 'Yes' : 'No') : String(result[key]))])];
      if (adapterMode) rows.push(
        ['Versioned adapter replay (fixture only)', ...results.map(result => result.adapterBoundary?.allStepsEqual === true ? 'Matches every step' : 'Unavailable or diverged')],
        ['Controlled frontend iterations', ...results.map(result => String(result.adapter?.counterDelta ?? 'Unavailable'))],
        ['Queued restore matches checkpoint', ...results.map(result => result.adapter?.restoreMatchIndex >= 0 ? 'Yes' : 'No')],
        ['Input trace replay matches', ...results.map(result => result.adapter?.replayEqual ? 'Yes' : 'No')],
        ['Single-frame steps in fixture', ...results.map(result => result.adapter?.fixtureSingleFrameSteps ? 'Yes' : 'Unverified')],
        ['Replay differing bytes', ...results.map(result => String(result.adapter?.differingBytes ?? 'Unavailable'))],
        ['First divergent replay step', ...results.map(result => String(result.adapter?.firstDivergentStep ?? 'None'))],
        ['Replay with refresh sidecar (fixture only)', ...results.map(result => result.adapter?.refreshSidecarReplay?.available ? (result.adapter.refreshSidecarReplay.allStepsEqual && result.adapter.refreshSidecarReplay.fullStateReplayEqual ? 'Matches every step' : 'Diverged') : 'Unavailable')],
        ['CPU fields to investigate (unverified layout)', ...results.map(result => result.adapter?.fieldHypotheses?.join(', ') || 'Unclassified')],
        ['Game VBlank range', ...results.map(result => result.adapter?.gameFrameBefore ? `${result.adapter.gameFrameBefore.value} → ${result.adapter.traceGameFrames.at(-1)}` : 'Frame fixture required')],
      );
      for (const [index, row] of rows.entries()) {
        const tr = table.insertRow();
        for (const text of row) { const cell = document.createElement(index ? 'td' : 'th'); cell.textContent = text; tr.append(cell); }
      }
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = 'Raw evidence and state hashes';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(report, null, 2);
      details.append(summary, pre);
      document.querySelector('#results').replaceChildren(table, details);
      const fixtureReplayMatches = adapterMode && results.every(result => result.adapter?.refreshSidecarReplay?.allStepsEqual && result.adapter.refreshSidecarReplay.fullStateReplayEqual && result.adapterBoundary?.allStepsEqual);
      status.textContent = fixtureReplayMatches ? 'Fixture replay matches at every step with restored CPU timing. Multiplayer remains gated.' : 'Probe complete. Both runtimes are paused. Exact-frame synchronization remains unverified.';
      download.disabled = false;
    } catch (error) { status.textContent = error.message; }
    finally { probe.disabled = !clients.every(client => client.started); input.disabled = false; traceLength.disabled = false; }
  });
  download.addEventListener('click', () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'genesis-capability-report.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
