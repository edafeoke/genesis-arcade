> **Playable multiplayer is available.** For two browsers on this computer, open Play online, add the free Quickdraw Duel demo, create/join a room, match games, ready up, and select Start Game. The host can select Shared keyboard for both players. [Full controls and setup](docs/HOST_STREAMING.md). This is host streaming; rollback and deterministic two-core netplay remain research work.

# Genesis Arcade

A local-first Sega Genesis arcade built with Next.js App Router, TypeScript and Tailwind CSS.

## Run

```sh
pnpm install
pnpm dev
```

Open the URL printed by Next.js. Use HTTPS or localhost so Web Crypto is available for SHA-256 hashing.

## Available now

- Responsive dark dashboard, library, favorites, settings and multiplayer roadmap.
- Local `.md`, `.gen`, `.bin` import (uncompressed, up to 32 MB).
- IndexedDB ROM/metadata persistence and content-based SHA-256 deduplication.
- Search, favorite, export and remove games.
- Named local save snapshots with import/export, load and deletion.
- Persistent online controller remapping, opt-in direct ROM sharing and four spectator seats.
- Local guest identity and editable display name.
- Self-hosted EmulatorJS 4.2.3 / Genesis Plus GX 2.0.2 player with keyboard/gamepad mapping, fullscreen, restart and error recovery.
- Emulator toolbar save/load states using browser storage, plus save import/export.
- Explicit production offline download under Settings, covering the app shell, chunks, fonts and runtime.
- Public lobbies with game filtering, occupancy/readiness, pagination and server-checked joins.
- Separate Socket.IO service and private waiting rooms: secure code/invitation joins, controller slots, ROM/profile matching, readiness, leave, expiry and reconnection.

ROMs are not uploaded. Browser data deletion removes the collection. Export files to keep backups. A supported filename is not proof that the contents are a valid Genesis ROM.

## Not yet implemented

Deterministic two-core synchronization and rollback. Casual host-streamed multiplayer is playable; deterministic netplay remains unavailable. Physical gamepad and commercial-game compatibility require further device testing.

See [product requirements](docs/PRODUCT_REQUIREMENTS.md) and [emulator research gates](docs/EMULATOR_RESEARCH.md).

## Checks

```sh
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Next.js fonts are loaded from the installed package, avoiding build-time Google Fonts requests. This package-internal path should be checked when upgrading Next.js.

## Player and offline use

Import a ROM, open its details, choose **Play locally**, then select **Start game** inside the player. Click the canvas before using the keyboard. Controller settings show and remap the keys. Closing the player removes its iframe and stops that emulator instance. Save before closing; game-state and SRAM support depend on the game/core. Save keys use the ROM SHA-256 to avoid filename collisions.

For offline use, run a production build and server:

```sh
pnpm build
pnpm start
```

If this environment blocks Turbopack's internal process/port use, `pnpm build:webpack` provides the webpack build and generates the same offline package. In Settings, choose **Download for offline**, wait for confirmation, then reload once. Browser eviction or clearing site data can remove the package, games and saves. Offline downloads are disabled in development mode. Refresh the download after a deployment. Previous packages are retained for open tabs; clearing this site's cache removes them.

Emulator assets are vendored in `public/emulator/4.2.3`, with licenses, provenance, local patch notes and SHA-256 checksums. No runtime CDN fallback or remote update check is used. Review the core's included license before commercial redistribution.

## Diagnostic smoke test

```sh
node scripts/generate-diagnostic.mjs /tmp/genesis-diagnostic.bin
node --test scripts/service-worker.test.mjs
```

Import the original CC0 diagnostic ROM: blue output confirms emulation; hold Up after focusing the canvas for red, release for blue. Use it to verify keyboard routing, state persistence, restart and offline reload without bundling a commercial ROM. This is a smoke test, not broad game compatibility or synchronized-play certification.

## Private multiplayer rooms

Run `pnpm server:dev` alongside `pnpm dev`. Open **Play online → Connect to multiplayer → Create Room**. Share its code or invitation link. Each player chooses their locally stored game and confirms its two-player mode. The host can swap controller positions. **Start Game** launches host-streamed casual gameplay when both players are ready. See [playable multiplayer instructions](docs/HOST_STREAMING.md).

See [multiplayer setup, protocol, limits and production notes](docs/MULTIPLAYER.md). The room service is optional for local single-player.

For public hosting, follow [Vercel + Render deployment](docs/DEPLOYMENT.md).
The repository includes a Render Blueprint and `pnpm check:multiplayer` to verify
the deployed service's health and WebSocket connection.

In Play online, select **Public Lobbies** to browse or create a public room after connecting. Public creation requires a locally stored game. Full rooms and reconnecting hosts cannot be joined. Matching ROM contents and two-player-mode confirmation are still checked inside the waiting room; host streaming starts after both players are ready; deterministic netplay remains unavailable.

## Synchronization capability lab

Open `/sync-lab/index.html` on the running app (also linked from Play online). Generate the CC0 diagnostic above, choose it in the lab, start both runtimes and run the capability probe. Export report downloads measurements and hashes, never ROM or state bytes. The lab runs without the room service; its page requires the application server and is not part of the offline download.

The measured pinned core holds its frame counter and repeats serialization while paused, but immediate paused restoration did not reproduce the baseline bytes in either runtime. No verified single-frame step is available through the inspected wrapper. See [evidence and next adapter requirements](docs/EMULATOR_RESEARCH.md) and the [browser report](docs/emulator-capability-report.json). This is two-instance capability testing, not two-browser synchronized gameplay. The deterministic netplay gate remains blocked; casual streaming uses a separate session path.

To test the isolated instrumented loop adapter (requires Python 3):

```sh
pnpm lab:build
node scripts/generate-diagnostic.mjs /tmp/genesis-frame-diagnostic.bin --frames
```

Start/restart the app server after generating new public files, open `/sync-lab/index.html?adapter=1`, select the frame diagnostic, start both cores, then run the probe. Re-run `lab:build` after changing lab player scripts. Generated lab assets are ignored by Git and excluded from the offline package; normal gameplay uses the original core. The builder verifies the pinned archive, changes only its JavaScript glue and preserves WASM/license bytes. The frame fixture has a VBlank counter in emulated RAM; it is a diagnostic, not a multiplayer game.

The Asyncify-aware adapter reproduced queued checkpoint restoration and one-frame progression in the fixture, but the restored input-trace replay still differed by 1–5 bytes in the measured runs. See the follow-up research and [exported adapter report](docs/emulator-adapter-report.json) before extending it into a gameplay scheduler.

The lab now offers 16- and 120-step traces (120 by default), hashes every step, and reports the first replay divergence. The [initial 120-step evidence](docs/emulator-divergence-report.json) diverged at step 1 in both runtimes despite matching checkpoint bytes. That run applied no raw WASM-memory correction; CPU field labels were provisional. No mismatched bytes are ignored.

The follow-up found a missing CPU bus-refresh timing field. A strictly fixture-only timing sidecar now preserves that field after queued restoration. In the [first positive experiment](docs/emulator-refresh-proof-initial.json), both runtimes matched every one of 120 replay-step hashes and the final full-state hash; ordinary restoration still diverged. The helper requires the known diagnostic hash and a unique live CPU signature. This is evidence for a diagnostic restoration fix, not general multiplayer readiness. Normal gameplay still uses the original core, and deterministic netplay remains disabled; host streaming uses the original core.

A [fresh-instance repeat](docs/emulator-refresh-proof-repeat.json) reproduced all 120 matching corrected steps in both runtimes and includes the exact probe/bridge script fingerprints. The next gate is a versioned general adapter, controller-port verification and a two-browser networking proof of concept.

## Synchronization coordination foundation

The [versioned adapter and delay-lockstep modules](docs/SYNCHRONIZATION_ADAPTER.md) now implement checksummed state/auxiliary-timing snapshots, serialized native operations, controller-slot isolation and bounded frame-numbered input buffering. Missing input stalls; duplicates/reordering are handled; conflicting input or disconnects stop the epoch and release buttons.

Run `pnpm test:sync` for 17 focused checks, including two model peers reaching identical full snapshots across a 300-sample trace with jittered/reversed delivery and duplicates. These are model/transport simulations. A general EmulatorJS backend and live two-browser wiring remain unimplemented; deterministic room:start stays disabled; the UI uses stream:start for casual host streaming.

The instrumented lab now also runs the versioned adapter against the exact CC0 frame diagnostic. It checks measured video frames and byte-exact queued restoration plus the timing sidecar; per-step snapshot checksums include auxiliary timing. Run `pnpm lab:build` before using `?adapter=1`. This remains a local replay test, with no live gameplay transport.

See [save management, controls, ROM sharing and spectator instructions](docs/SAVES_SHARING_SPECTATORS.md).
