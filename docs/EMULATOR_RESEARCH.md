# Emulator integration gate

Reviewed official documentation on 2026-10-17:

- https://emulatorjs.org/docs/getting-started/ describes embedding a local `data/loader.js` runtime.
- https://emulatorjs.org/docs/systems/sega-mega-drive/ documents `segaMD` and the default `genesis_plus_gx` core.
- https://emulatorjs.org/docs/options/ documents save-state hooks and a netplay server option.

These were the initial documentation findings. The integration and capability measurements below supersede the original acquisition gate; exact frame execution and rollback remain unverified.

Before adding the multiplayer service, acquire and pin a self-hosted distribution including its Genesis core, licenses and checksums. Verify loading a locally supplied ROM without transmitting its bytes. Test keyboard/gamepads, SRAM/save-state persistence and offline app/runtime reload. Do not rely on CDN assets for offline support.

## Synchronization capability experiment — 2026-10-17

`/sync-lab/index.html` runs two isolated player iframes with the same locally hashed ROM and fixed profile. The lab-only hook is inactive without `?lab=1`; ordinary single-player never accepts probe commands. Origin, parent window and numeric request IDs are checked. No Socket.IO connection, ROM upload or state-byte transmission occurs. The optional JSON export contains hashes, measurements, timestamp and browser user agent. Do not interact with either emulator while measuring; physical gamepads are not disabled by the probe.

The probe pauses, waits for settling, serializes twice across 200 ms, resumes for approximately 250 ms with released input, pauses, loads the captured state and serializes again while paused. It reports raw equality rather than assuming that a successful load call means restoration completed. Failed probes restore keyboard access and leave the core paused. The exported frame-control names are a heuristic inventory of module properties, not proof that an internal or unexported capability cannot exist.

Measured on the original CC0 diagnostic with the pinned legacy/single-thread profile:

| Measurement | Runtime A | Runtime B |
|---|---|---|
| Paused frame counter | 219 → 219 | 151 → 151 |
| Paused serialization repeats exactly | Yes | Yes |
| State size | 1,036,312 bytes | 1,036,312 bytes |
| Counter after timed resume | 231 | 162 |
| Immediate paused restore equals baseline | No | No |
| Exported frame-related module properties | `_get_current_frame_count` | `_get_current_frame_count` |

Raw browser evidence is in [emulator-capability-report.json](emulator-capability-report.json). The unequal initial frame numbers are expected from independent startup; cross-instance state equality was not asserted. The restore mismatch may reflect deferred loading or frontend metadata in serialization. It does **not** prove that the underlying core cannot restore state. It does mean that this wrapper has not passed the restoration gate needed for our adapter. Two instances within one browser do not establish cross-browser determinism.

### Adapter decision and alternatives

Do not build a gameplay scheduler around `setTimeout` plus pause/resume: the measured frame increments differ, and an exact execution boundary is unverified. Keep the room start gate closed. Delay-based lockstep still needs controlled, consistent frame execution; rollback additionally needs verified restoration and replay.

The next preferred experiment is a separately pinned build of the EmulatorJS/RetroArch frontend that exposes synchronous `stepFrame(player1Mask, player2Mask)`, `captureState()` and `restoreState(bytes)` operations at a defined frame boundary, with automatic execution disabled. Preserve the current offline player while evaluating it. Inspect the load-state return code and whether a queued command needs a frontend iteration before designing the adapter.

If that frontend cannot provide reliable boundaries, evaluate a dedicated WASM libretro host for the same Genesis core. The [official libretro contract](https://docs.libretro.com/development/cores/developing-cores/#retro_run) defines `retro_run()` as one video frame and documents serialization APIs; that is an API target, not evidence that our existing binary exports those operations or that a replacement is already implemented. A dedicated host adds audio/video, input, persistence and build-maintenance work, so do not silently replace single-player.

Before selecting either: run a fixed two-controller input trace from the same initial state; compare core-state hashes at exact checkpoints; restore and replay checkpoints; repeat across separate browsers/devices; then inject network jitter, duplicates, reordering and disconnects. Inspect serialization metadata before deciding what a stable state checksum covers. No rollback or competitive claim is justified by the present evidence.

For the early two-browser prototype, record distribution/core/configuration hashes; test same initial state and input trace on each browser; compare periodic state hashes where serialization is stable. Verify single-frame stepping, controller isolation, deterministic state restoration, and long-run consistency across browsers. Introduce latency/jitter/duplicates and disconnects. If these controls cannot be verified, stop the synchronized-play claim and evaluate a lower-level libretro/WASM adapter. Ordinary Socket.IO button forwarding is not sufficient.

## Implemented single-player integration

Pinned EmulatorJS **4.2.3**, with Genesis Plus GX **2.0.2** (official core report dated 2025-06-14). All runtime files are self-hosted under `public/emulator/4.2.3`. The exact distribution has SHA-256 checksums, upstream licenses, binary provenance and documented local patches. Both CDN update checks and remote core fallback are disabled; the isolated player page also blocks external requests with CSP. Original core archive contents were preserved while converting 7z packaging to ZIP to reduce browser startup cost.

The application sends a locally stored ROM Blob into a fresh same-origin player iframe using a source/origin-checked message bridge. The ROM never becomes an HTTP upload. Closing or retrying removes that frame and its runtime. Local single-player uses no Socket.IO service. The selected single-thread legacy core is fixed, and core/thread selector settings are hidden. Supported saves use EmulatorJS's native IndexedDB storage; ROM SHA-256 identifies each game's save namespace. Full application save management is still a later phase.

Production builds generate an opt-in offline package containing the HTML shell, static chunks/fonts, player page, local scripts and cores. Installation fails and removes a partial package if an asset cannot be downloaded. The worker does not intercept API calls or cache ROM blobs. Old packages are retained for tabs using prior builds.

### Verification on 2026-10-17

- Lint, TypeScript and webpack production build passed.
- Four service-worker tests passed: complete package, failed-download cleanup, offline navigation/API exclusions, and missing-resource readiness.
- Browser imported the original CC0 diagnostic generated by `scripts/generate-diagnostic.mjs` and persisted it across reload.
- Genesis core rendered the expected blue image. Holding Up with the canvas focused changed it to red; releasing returned blue.
- Native Save State reported `SAVE SAVED TO BROWSER`.
- Offline installation completed; every declared resource returned HTTP 200 before disconnecting.
- Stopped the local production server and confirmed its port was unreachable. Reloaded the app, opened the IndexedDB ROM and started the emulated diagnostic successfully from cache.
- Native Load State after that offline reload reported `SAVE LOADED FROM BROWSER`.
- Restart returned to a new Start Game screen; close left zero player iframes.

These checks establish a basic single-player/offline smoke test. Physical gamepad testing, audible game audio, supported commercial-game compatibility, SRAM round trips and separate-device testing remain unverified. No two-browser synchronization, deterministic-state comparison, rollback or competitive networking has been implemented or certified. Source inspection shows internal state methods, but that is not proof of reliable frame stepping or rollback support.

## Controlled-loop adapter follow-up

The lab now has a separately generated core archive. `pnpm lab:build` checks the source archive against the vendored SHA-256 manifest and instruments only the Emscripten JavaScript glue. WASM and other archive entries remain unchanged. The generated provenance records both archive hashes. The current hook waits for any Asyncify suspension to finish and suppresses automatic loop resumption while its operation is in progress. It refuses entry unless the scheduler is paused and no suspended call is active. Normal single-player keeps the original distribution; the instrumented player and scripts live outside the offline cache under `/sync-lab/runtime/`.

Source orientation: [EmulatorJS RetroArch `retroarch.c` at 12076775](https://github.com/EmulatorJS/RetroArch/blob/12076775af6db24b7bfb808a3ced3a760adeab63/retroarch.c) shows the frontend loop counter and `load_state` calling a queued content operation; [task_save.c](https://github.com/EmulatorJS/RetroArch/blob/12076775af6db24b7bfb808a3ced3a760adeab63/tasks/task_save.c) shows task dispatch and serialization. This inspected revision is not asserted to be the source revision used to build the pinned binary. Conclusions below are runtime observations of the pinned binary plus documented JS instrumentation.

The first direct synchronous-loop experiment caused an Asyncify memory error and was rejected. The replacement awaits suspended execution before any subsequent core call. With it, both runtimes reproduced checkpoint bytes after one controlled iteration completed the queued load. This supersedes the earlier immediate-load limitation only for the instrumented experiment; the ordinary player's load operation remains queued.

The original CC0 ROM generator now supports `--frames`. That variant writes the unique `GENESISLABFRAME1` marker and a 32-bit counter into work RAM at `$ff0000`/`$ff0010`; it increments once per observed VBlank edge. The probe locates that marker in state serialization in either word byte order and records counters after each iteration. It does not interpret arbitrary game states as this fixture or transmit state bytes.

Measured in two isolated runtimes on one browser:

- Each of 16 controlled iterations advanced the fixture by one VBlank, both before and after restoration.
- The queued restore reproduced the checkpoint's full serialized hash in both runtimes.
- Replayed game-frame sequences matched their original sequences exactly.
- The first replay experiment differed by five serialized bytes in each runtime. A repeat recorded five differences in A and one in B. The probe records differing byte offsets (bounded to 64), without discarding any bytes from checksums. The repeat differed at offsets 144180, 144181, 144244, 144248 and 144258 in A, and 144258 in B.

The repeat's [raw adapter report](emulator-adapter-report.json) and [archive provenance](emulator-adapter-provenance.json) preserve these results. In that run, A's work-RAM counter advanced from 2096 to 2112 and B's from 1954 to 1970; each replay repeated those exact sequences. No interpretation of the differing fields is yet verified.

The fixed input trace assigns Up (RetroPad index 4) to controller 1 for its first eight iterations and controller 2 for its next eight. This tests a trace through the adapter, not the game's two-player mode or physical controller routing. Human input must remain idle. Keyboard input is disabled during the probe and its injected buttons are released on completion/failure.

The adapter is still experimental. A fixture passing one-frame progression is not general certification. Before networking, identify the replay mismatch in the core serialization layout, verify both controller ports with a suitable fixture, test longer traces and mixed inputs, and establish cross-instance/cross-browser convergence from the same initial state. Do not mask unexplained fields merely to make hashes match. Public/private room Start Game remains blocked; rollback remains unimplemented.

## Per-step divergence follow-up

The probe now accepts only 16 or 120 controlled iterations, releases its injected inputs on failure, and exports a SHA-256 hash for every original and replay step. It finds the earliest divergent step rather than comparing only end states. The lab defaults to 120 steps and keeps its trace selector disabled while measuring. Raw state bytes stay inside their iframe.

The [120-step report](emulator-divergence-report.json) measured:

| Measurement | Runtime A | Runtime B |
|---|---|---|
| Checkpoint serialization restored exactly | Yes | Yes |
| Game-frame count | 1942 → 2062 | 1583 → 1703 |
| Original and replay game-frame sequences equal | Yes | Yes |
| First serialized-state divergence | Step 1 | Step 1 |
| Different bytes at end | 1 | 4 |
| Fields suggested by inspected source layout | 68000 cycles | 68000 D0, PC, SR |

The field mapping is a **hypothesis**, not a verified binary layout: the source inspected so far is the repository's current `core/state.c`, `core/m68k/m68k.h`, `core/m68k/m68kcpu.c` and `core/system.c`. Its serialized register order corresponds to the observed offset pattern. That source's bus-refresh timing accumulator affects CPU execution and is not listed in its save-state routine, making hidden CPU timing a candidate explanation. The source revision actually used by the pinned build has not been established. The last commit preceding the reported build timestamp, `def3a7c0e413ef35a7d9d4430e5c9c9a5698b4fe`, is only a historical candidate, not proven build provenance.

A guarded attempt to locate the live CPU structure uniquely did not validate a matching structure in either runtime. No correction was applied. The speculative memory-write code was removed; the shipping lab only reports evidence and provisional field labels. Do not derive a production memory address from a current header or discard the affected CPU fields.

First-step divergence narrows the next investigation to complete restoration and hidden runtime state, rather than late accumulation alone. It does not prove the refresh-accumulator hypothesis. Verify historical source and build options, reproduce the missing-state mechanism with an explicit exported API or a reproducible core build, and repeat the original/replay comparison before wiring gameplay inputs into rooms.

Verification for this change: 14 script tests and 15 room/lobby unit tests passed; lint and the webpack production build passed. The 120-step browser run produced no console errors. Socket.IO integration tests were not rerun in this step. Start Game remains disabled.

## Missing bus-refresh state: positive controlled experiment

Historical downloads resumed successfully. At the [historical candidate's CPU header](https://github.com/EmulatorJS/Genesis-Plus-GX/blob/def3a7c0e413ef35a7d9d4430e5c9c9a5698b4fe/core/m68k/m68k.h), the structure contains `cycles`, `refresh_cycles`, `cycle_end`, then the 16 data/address registers and PC. Its [save/load implementation](https://github.com/EmulatorJS/Genesis-Plus-GX/blob/def3a7c0e413ef35a7d9d4430e5c9c9a5698b4fe/core/state.c) stores `cycles` but omits `refresh_cycles`. Downloaded file hashes and the explicit build-provenance limitation are recorded in [emulator-historical-source.json](emulator-historical-source.json).

A read-only live-memory scan compared all 16 registers and PC with the serialized checkpoint. Additional prefix checks required matching cycle count and the fixture's NTSC frame endpoint (896040 master cycles). This isolated one live CPU structure from saved-buffer copies. The scan is bounded to the first 32 MiB and eight candidates; invalid fixture register values are rejected before scanning. Initial evidence observed refresh timing changing from -936 to 784000 during restoration despite an identical serialized hash. Negative refresh values are legitimate in the measured frame-boundary representation; the earlier -896 lower bound was too narrow.

The controlled test keeps ordinary restoration as its failing control, then restores the same checkpoint again and writes back **only** the captured extra `refresh_cycles` value. It never rewrites serialized bytes, masks CPU fields or filters checksums. A write is allowed only for the exact CC0 frame-fixture SHA-256, state size, validated register signature, matching cycle endpoint, a unique candidate, and a freshly revalidated live address after restoration. Ambiguous/unknown layouts disable the experiment. This is a lab-only sidecar, not a generic WASM memory patch or production adapter.

The [first positive report](emulator-refresh-proof-initial.json) measured two runtimes:

| Measurement | Runtime A | Runtime B |
|---|---|---|
| Captured extra refresh timing | -40 | -40 |
| Value after ordinary restoration | 784000 | 784000 |
| Ordinary replay | Diverged at step 1 | Diverged at step 1 |
| Replay with extra timing restored | All 120 step hashes match | All 120 step hashes match |
| Final full serialized-state hash matches original trace | Yes | Yes |

This controlled comparison demonstrates that preserving the missing refresh field resolves the observed diagnostic replay failure. It does not establish complete state support for all games or devices. General core provenance is still not proven solely from the historical timestamp; the register-layout correspondence and behavior were measured against the pinned binary itself.

The next implementation should expose this extra timing through an explicit, versioned core adapter or reproducible core build, rather than extending signature-based writes to arbitrary games. Verify both controller ports with a suitable diagnostic, common initial state across independent runtimes, longer/mixed input traces and separate browsers before connecting room gameplay. The normal single-player core and both room start gates remain unchanged. No rollback is implemented.

Lab provenance now fingerprints the player bridge and probe scripts as well as the original/instrumented archives, so future reports distinguish measurement code changes from core changes. Automated regression coverage includes omitted-state replay, negative timing values, ambiguous CPU matches, unknown-ROM rejection and input release after failure.

### Fresh-instance repeat

The [repeat report](emulator-refresh-proof-repeat.json) includes script fingerprints and the `fixture-refresh-sidecar-v1` experiment identifier. Both fresh instances again matched every one of 120 corrected replay-step hashes and the final full state. Their ordinary replays still diverged at step 1. A's original/replayed game-frame range was 2833–2953; B's was 2721–2841. Neither browser run produced console errors.

All 38 automated checks passed (17 script/offline checks plus 21 room, discovery and Socket.IO checks); lint, TypeScript and the webpack production build passed. This supersedes the earlier historical-download block and the earlier diagnostic replay failure, while preserving their raw reports for comparison. It does not open the general multiplayer start gate.
