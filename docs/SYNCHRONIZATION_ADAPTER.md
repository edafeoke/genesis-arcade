# Versioned adapter and delay-lockstep foundation

This implementation is transport-independent orchestration. It does not enable room gameplay, supply a verified general EmulatorJS backend, or certify two-browser synchronization. The existing lab's measured timing sidecar remains restricted to its known diagnostic ROM.

## Adapter boundary

`lib/emulation/adapter.ts` defines `genesis-adapter-v1` and a working `VersionedEmulatorAdapter`. A backend owns its execution loop and supplies measured single-video-frame stepping, completed capture/restore operations, and idempotent input release. Core/frontend iteration counts cannot substitute for measured emulated video frames.

The adapter:

- Validates a SHA-256 identity tuple for ROM contents, core artifact, frontend/runtime artifact and emulator settings, plus the adapter ABI version.
- Serializes step, capture, restore and release operations, including while an asynchronous native operation is pending.
- Checks that a backend reports exactly one emulated video frame per step; a mismatch faults the adapter and requests input release.
- Captures opaque core bytes **and** named auxiliary timing state. Snapshot checksums cover both, the identity tuple and logical frame number. No missing field is normalized out of a checksum.
- Rejects corrupted or incompatible snapshots before invoking native restoration. Copies prevent queued restore data from being changed by its caller.
- Limits state to 16 MiB and auxiliary metadata to 64 finite numeric fields with bounded names.
- Refuses unverified capabilities. A backend marked fixture-only requires explicit `allowFixtureOnly` opt-in.

Backend capability flags are implementation assertions, not remote attestation. They must be backed by emulator-specific tests. The class does not turn an arbitrary backend into a verified emulator merely because it implements the interface. Snapshot hashes detect mutation/corruption; they are not authentication or anti-cheat.

`lib/emulation/fixture-backend.ts` implements this boundary for the exact CC0 VBlank diagnostic ROM only. It checks the ROM hash, state size, unique matching live CPU registers, and measured video-frame counter. Restoration waits up to four native ticks for a byte-exact checkpoint match, restores the missing `refresh_cycles` field, and verifies serialized bytes remain unchanged. This is not a general EmulatorJS backend. A future backend must preserve all required hidden timing/peripheral state and version its fingerprints accordingly.

Run `pnpm lab:build` to bundle `lab/adapter-proof.ts` into the isolated instrumented player. The existing `?adapter=1` probe additionally runs a versioned-adapter capture/trace/restore/replay and records per-step snapshot checksums. The bundle and player scripts are fingerprinted in provenance. Settings identity currently covers core options only; transport integration must also fingerprint effective native configuration. Do not negotiate this diagnostic identity for a network session yet.

Browser evidence: `emulator-versioned-adapter-proof.json` records two isolated runtimes each passing all 16 measured steps and versioned replay checksums. These are independent local replays, not a shared checkpoint or network session. Earlier 120-step attempts exceeded the old timeout; the new backend's longer browser trace remains unverified. The probe allows a bounded 120-second instrumented run. Read-only captures reuse the CPU address after checking its complete register signature; restoration performs a fresh uniqueness scan. The pinned diagnostic counter is validated at serialized work-RAM offset 32; changed layouts are refused.

## Input ownership and buffering

`lib/multiplayer/lockstep.ts` implements `InputLockstep`. A trusted session binding sets the local controller slot; incoming packets have no player/slot override. Each packet carries exactly a version, session epoch UUID, sequence, target frame and complete 16-bit controller mask. Unknown fields, invalid masks and inconsistent frame/sequence pairs are rejected.

Both peers must negotiate the same epoch, identities, input delay, slot assignments and initial checkpoint **before** constructing the buffer. Samples are consecutive and target `sampleFrame + inputDelay`. Each target frame has a full mask, including releases; this layer does not depend on receiving a button-up edge alone. Agreed startup delay frames are neutral on both controllers.

The buffer waits when either player's input is missing. It never predicts, skips a frame or falls back to wall-clock button forwarding. Bounded future windows and retained recent history support out-of-order delivery and exact duplicate suppression. A conflicting retransmission terminates the epoch and requests input release. Old-epoch traffic is ignored. Future buffers/history remain bounded.

`advance()` uses a bounded frame budget and coalesces concurrent calls. The versioned adapter serializes native calls. `stop()` clears queued input and releases controls; disconnect ends the epoch. Rejoining gameplay needs a new agreed checkpoint and epoch rather than resuming an old input queue.

## Verification

Run:

```sh
pnpm test:sync
pnpm test
```

Seventeen synchronization tests cover state replay with auxiliary timing, corrupted bytes/metadata, identity mismatch, operation ordering, capability gating, invalid frame advancement, missing input, controller isolation, duplicate/conflicting/reordered traffic, bounded input windows, disconnects and stop behavior.

Two simulated peers consumed identical 300-sample traces under reversed batch delivery and duplicates. A combined model-backend test compared complete checksummed snapshots at every batch checkpoint, finishing at 302 emulated steps including its agreed two-frame input delay. These tests use deterministic model backends and simulated transport. They are not evidence of real browser networking, EmulatorJS controller routing or gameplay compatibility.

The full suite has 55 checks: 17 script/offline tests plus 38 adapter, fixture backend, lockstep, rooms, discovery and Socket.IO tests. Lint, TypeScript and production build are checked separately. Three fixture-backend tests exercise queued restoration, omitted timing, controller masks/releases, wrong ROMs, ambiguous CPU locations, invalid checkpoints, failed loads, and skipped video frames using a native-surface model.

## Remaining integration gate

1. Implement a concrete versioned backend for the pinned emulator with explicit frame boundaries and complete state restoration; retain normal single-player independently.
2. Verify both controller ports with a suitable two-controller diagnostic and establish a shared initial state across independent runtimes.
3. Add an opt-in experimental transport with authoritative room membership/slot binding, readiness/identity negotiation, bounded packet validation and appropriate per-frame traffic quotas. Existing waiting-room rate limits are unsuitable for 60 input packets/second and are deliberately unchanged.
4. Exchange checkpoints/hashes and stop on divergence; add latency/jitter/stall diagnostics and disconnect handling.
5. Run two-browser and separate-device/network tests using a compatible two-player game before opening Start Game.

No gameplay input endpoints, new Socket.IO quotas, rollback claims or room-start bypasses are added by this foundation.
