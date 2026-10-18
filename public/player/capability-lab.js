/* Internal capability probe. No socket, ROM upload, or gameplay synchronization. */
(() => {
  if (new URLSearchParams(location.search).get('lab') !== '1') return;
  const channel = 'genesis-capability-lab-v1';
  let busy = false;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const diagnosticCounter = bytes => {
    const marker = Array.from('GENESISLABFRAME1', char => char.charCodeAt(0));
    for (const swapped of [false, true]) {
      const pattern = marker.map((value, index) => swapped ? marker[index ^ 1] : value);
      for (let offset = 0; offset <= bytes.length - 20; offset++) {
        if (!pattern.every((value, index) => bytes[offset + index] === value)) continue;
        const value = Array.from({ length: 4 }, (_, index) => bytes[offset + 16 + (swapped ? index ^ 1 : index)]);
        return { value: (value[0] * 16777216 + value[1] * 65536 + value[2] * 256 + value[3]) >>> 0, offset, swapped };
      }
    }
    return null;
  };
  const inspectCpuLayout = (manager, state) => {
    if (window.EJS_gameName !== 'c12ec5da51b65a46838808ce9a0beadc98ea8308a028197789c9354ef6134a3d' || state.length !== 1036312 || !manager.Module.HEAPU8) return null;
    const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
    const registers = Array.from({ length: 17 }, (_, index) => view.getUint32(144180 + index * 4, true));
    if (registers[15] !== 0x00fffffc || registers[16] < 0x200 || registers[16] >= 0x1000) return { fixedOffsetLayoutMatches: false, d0: registers[0], sp: registers[15], pc: registers[16], cycles: view.getInt32(144258, true) };
    const heap = new Int32Array(manager.Module.HEAPU8.buffer);
    const candidates = [];
    for (let index = 6; index < Math.min(heap.length - 17, 8 * 1024 * 1024); index++) {
      if ((heap[index] >>> 0) !== registers[0] || (heap[index + 15] >>> 0) !== registers[15] || (heap[index + 16] >>> 0) !== registers[16]) continue;
      if (registers.every((value, offset) => (heap[index + offset] >>> 0) === value) && candidates.length < 8) candidates.push({ address: index * 4, prefix: Array.from(heap.subarray(index - 6, index)) });
      if (candidates.length === 8) break;
    }
    return { d0: registers[0], sp: registers[15], pc: registers[16], cycles: view.getInt32(144258, true), candidates };
  };
  const uniqueFixtureCpu = evidence => {
    // NTSC VBlank fixture, historical header: cycles, refresh_cycles, cycle_end, dar[16], pc.
    const matches = evidence?.candidates?.filter(candidate => candidate.prefix[3] === evidence.cycles && candidate.prefix[5] === 896040 && Math.abs(candidate.prefix[4]) <= 2 * 896040) || [];
    return matches.length === 1 ? matches[0] : null;
  };
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel || event.data.type !== 'probe' || !Number.isSafeInteger(event.data.id)) return;
    const reply = result => parent.postMessage({ channel, id: event.data.id, ...result }, location.origin);
    const traceLength = event.data.frames ?? 16;
    if (![16, 120].includes(traceLength)) { reply({ error: 'Choose a trace length of 16 or 120 frames.' }); return; }
    if (busy) { reply({ error: 'A probe is already running.' }); return; }
    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;
    if (!manager || emulator.paused === undefined) { reply({ error: 'Start this emulator before running the probe.' }); return; }
    busy = true;
    try {
      // Release input and disable keyboard input before measuring.
      manager.functions.setKeyboardEnabled(0);
      for (let player = 0; player < 2; player++) for (let button = 0; button < 16; button++) manager.functions.simulateInput(player, button, 0);
      emulator.pause();
      await wait(100);
      const frame = manager.functions.getFrameNum();
      const baseline = manager.getState();
      const baselineHash = await hash(baseline);
      await wait(200);
      const pausedFrame = manager.functions.getFrameNum();
      const repeatHash = await hash(manager.getState());
      emulator.play();
      await wait(250);
      emulator.pause();
      await wait(100);
      const advancedFrame = manager.functions.getFrameNum();
      manager.loadState(baseline);
      await wait(100);
      const restoredHash = await hash(manager.getState());
      let adapter;
      if (typeof manager.Module.genesisLabTick === 'function') {
        const tick = () => manager.Module.genesisLabTick();
        for (let i = 0; i < 8; i++) await tick();
        const startFrame = manager.functions.getFrameNum();
        const checkpoint = manager.getState();
        const gameFrameBefore = diagnosticCounter(checkpoint);
        const checkpointHash = await hash(checkpoint);
        const checkpointCpu = inspectCpuLayout(manager, checkpoint);
        const runTrace = async () => {
          const frames = [];
          const hashes = [];
          for (let frame = 0; frame < traceLength; frame++) {
            manager.functions.simulateInput(0, 4, frame < traceLength / 2 ? 1 : 0);
            manager.functions.simulateInput(1, 4, frame >= traceLength / 2 ? 1 : 0);
            await tick();
            const state = manager.getState();
            frames.push(diagnosticCounter(state)?.value ?? null);
            hashes.push(await hash(state));
          }
          manager.functions.simulateInput(0, 4, 0);
          manager.functions.simulateInput(1, 4, 0);
          return { frames, hashes };
        };
        const trace = await runTrace();
        const traceGameFrames = trace.frames;
        const traceEndFrame = manager.functions.getFrameNum();
        const traceState = manager.getState();
        const traceHash = await hash(traceState);
        manager.loadState(checkpoint);
        // This is an experiment, not a restore primitive: queued load may need several ticks.
        const restoreHashes = [];
        for (let i = 0; i < 4; i++) {
          await tick();
          const restored = await hash(manager.getState());
          restoreHashes.push(restored);
          if (restored === checkpointHash) break;
        }
        const restoreMatchIndex = restoreHashes.indexOf(checkpointHash);
        const restoredCpu = restoreMatchIndex >= 0 ? inspectCpuLayout(manager, manager.getState()) : null;
        const replay = await runTrace();
        const replayGameFrames = replay.frames;
        const replayState = manager.getState();
        const replayHash = await hash(replayState);
        let differingBytes = Math.abs(traceState.length - replayState.length);
        const differingOffsets = [];
        for (let i = 0; i < Math.min(traceState.length, replayState.length); i++) if (traceState[i] !== replayState[i]) {
          differingBytes++;
          if (differingOffsets.length < 64) differingOffsets.push(i);
        }
        let refreshSidecarReplay = { available: false };
        const capturedCpu = uniqueFixtureCpu(checkpointCpu);
        const loadedCpu = uniqueFixtureCpu(restoredCpu);
        if (capturedCpu && loadedCpu && capturedCpu.address === loadedCpu.address) {
          manager.loadState(checkpoint);
          let restored = false;
          for (let i = 0; i < 4; i++) { await tick(); if (await hash(manager.getState()) === checkpointHash) { restored = true; break; } }
          const current = restored ? uniqueFixtureCpu(inspectCpuLayout(manager, manager.getState())) : null;
          if (current && current.address === capturedCpu.address) {
            // Preserve a missing CPU field, never normalize serialized data or ignore differences.
            // This write is restricted to the known fixture and a freshly validated unique CPU.
            new Int32Array(manager.Module.HEAPU8.buffer)[current.address / 4 - 2] = capturedCpu.prefix[4];
            const corrected = await runTrace();
            const correctedHash = await hash(manager.getState());
            const divergence = trace.hashes.findIndex((value, index) => value !== corrected.hashes[index]);
            refreshSidecarReplay = { available: true, experiment: 'fixture-refresh-sidecar-v1', capturedRefreshCycles: capturedCpu.prefix[4],
              ordinaryRestoredRefreshCycles: loadedCpu.prefix[4], correctedHash,
              fullStateReplayEqual: correctedHash === traceHash, allStepsEqual: divergence === -1,
              firstDivergentStep: divergence === -1 ? null : divergence + 1,
              stepHashes: corrected.hashes, gameFrames: corrected.frames };
          }
        }
        const firstDivergence = trace.hashes.findIndex((value, index) => value !== replay.hashes[index]);
        const fieldHypotheses = [];
        if (window.EJS_gameName === 'c12ec5da51b65a46838808ce9a0beadc98ea8308a028197789c9354ef6134a3d' && traceState.length === 1036312 && replayState.length === 1036312) {
          const fields = [
            ...Array.from({ length: 16 }, (_, index) => [index < 8 ? `68000 D${index}` : `68000 A${index - 8}`, 144180 + index * 4, 4]),
            ['68000 PC', 144244, 4], ['68000 SR', 144248, 2], ['68000 USP', 144250, 4],
            ['68000 ISP', 144254, 4], ['68000 cycles', 144258, 4],
          ];
          for (const [name, offset, size] of fields) {
            if (traceState.subarray(offset, offset + size).some((value, index) => value !== replayState[offset + index])) fieldHypotheses.push(name);
          }
        }
        adapter = { frontendTicks: traceLength, counterDelta: traceEndFrame - startFrame,
          stateChanged: traceHash !== checkpointHash, checkpointHash, traceHash, restoreHashes, restoreMatchIndex,
          replayHash, replayEqual: traceHash === replayHash, differingBytes, differingOffsets,
          gameFrameBefore, traceGameFrames, replayGameFrames,
          traceStepHashes: trace.hashes, replayStepHashes: replay.hashes,
          firstDivergentStep: firstDivergence < 0 ? null : firstDivergence + 1,
          cpuLayoutEvidence: { checkpoint: checkpointCpu, restored: restoredCpu },
          refreshSidecarReplay,
          fieldHypotheses, fieldLayoutVerified: false,
          fixtureSingleFrameSteps: Boolean(gameFrameBefore && traceGameFrames.every((value, index) => value === gameFrameBefore.value + index + 1) && replayGameFrames.every((value, index) => value === traceGameFrames[index])),
          exactEmulatedFrameVerified: false };
      }
      // A load may be deferred until a loop iteration; report this result honestly.
      const adapterBoundary = window.genesisAdapterProof ? await window.genesisAdapterProof(traceLength) : undefined;
      reply({ result: {
        frame, pausedFrame, advancedFrame,
        pausedCounterStable: frame === pausedFrame,
        pausedSerializationStable: baselineHash === repeatHash,
        resumeAdvanced: advancedFrame > pausedFrame,
        immediateRestoreEqual: baselineHash === restoredHash,
        stateBytes: baseline.byteLength, baselineHash, repeatHash, restoredHash,
        supportsStates: Boolean(manager.functions.supportsStates()),
        exportedFrameControls: Object.keys(manager.Module).filter(key => /^_.*(frame|step)/i.test(key)).sort(),
        exactFrameStepVerified: false,
        ...(adapter ? { adapter } : {}),
        ...(adapterBoundary ? { adapterBoundary } : {}),
      } });
    } catch (error) {
      reply({ error: error instanceof Error ? error.message : 'Capability probe failed.' });
    } finally {
      emulator.pause();
      for (let player = 0; player < 2; player++) manager.functions.simulateInput(player, 4, 0);
      manager.functions.setKeyboardEnabled(1);
      busy = false;
    }
  });
})();
