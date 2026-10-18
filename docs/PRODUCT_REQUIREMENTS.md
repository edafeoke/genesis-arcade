# Genesis Arcade product requirements

## Product decisions

A local-first, account-free Sega Genesis arcade, with casual co-op and versus online play for compatible games. Use a premium dark interface, electric blue accents, responsive cards, and subtle motion. Competitive networking is a future capability, not a launch claim.

Frontend: Next.js App Router, TypeScript, Tailwind CSS and shadcn/ui. Emulation: EmulatorJS running in the browser. Multiplayer: a separate Node.js/TypeScript service with Socket.IO. IndexedDB stores ROMs, metadata and supported save data. Single-player must never depend on the multiplayer server. Never upload or transmit ROM files to that server.

Each browser receives a locally stored cryptographic guest ID and editable display name. No initial account system. Future accounts may provide friends, profiles and cloud saves.

## Local library and player

Import local ROMs, calculate SHA-256 locally, deduplicate by content, persist locally and allow removal. Filename equality is never a compatibility check. Support keyboard and compatible gamepads. Provide save management for formats actually supported by the selected runtime. Self-host and pin runtime/core assets and cache the application and runtime before claiming offline gameplay. Browser storage can be cleared; provide export and clear storage errors.

## Private rooms

Two players initially. Create private rooms using cryptographically secure codes; join by code or validated invitation token/link. Display Player 1/Player 2 assignments, chosen game, ROM compatibility, emulator configuration, readiness and connection state. Host may start only when both players are ready and compatibility checks pass. Allow leaving, notify on opponent disconnect, and reconnect only where authoritative session state permits. Show Copy Invitation Link, Room Code, Ready/Not Ready, Start Game and Leave Session controls when implemented.

## Public lobbies

Create/browse public rooms, filter by game, show capacity, readiness and whether the host is waiting, and join available rooms. Prevent entry into full or expired rooms. Remove abandoned rooms and permit leaving at any time. Provide loading, empty and error states. Discovery exposes minimal information only; never leak private rooms, invitation credentials, guest reconnection tokens or ROM files. Original games must support the intended multiplayer mode; adding a public lobby does not add multiplayer to a single-player game.

## Compatibility and synchronization gates

Both clients must match SHA-256 hashes, pinned emulator/core versions and all relevant settings before starting. Confirm multiplayer capability where determinable, otherwise label it unverified. Assign separate controllers; remote inputs must not overwrite local input. Input packets carry frame IDs or sequences, reject duplicates/out-of-order traffic, handle delayed messages, and release held controls on disconnect. Measure RTT, jitter, input delay and connection state.

First prove synchronization between two browsers using a compatible two-player game. Investigate frame stepping/timing, deterministic execution, configurable input delay, state serialization and restoration. Choose a strategy based on verified runtime capabilities. Save-state UI hooks alone do not establish frame-level execution or rollback feasibility. Never advertise rollback before implementation and testing. If EmulatorJS lacks sufficient control, document evidence and evaluate another runtime/core integration before proceeding.

## Service security and reliability

Validate every message and bound its payload. Enforce room membership, controller ownership and host permissions on the server. Rate-limit creation and traffic, expire abandoned rooms, securely generate codes, validate invitation tokens and use secure WebSockets in production. Scope reconnection credentials to a session and avoid public exposure. No ROM storage or transmission. Keep public room records minimal.

## Phased delivery and acceptance

1. Dashboard/navigation: premium responsive UI with accurate empty and unavailable states.
2. Local library: import, IndexedDB persistence, local SHA-256, deduplication, export/removal; test refresh and storage failure.
3. Single-player: pinned, self-hosted EmulatorJS runtime; verify actual gameplay with a legally supplied ROM and offline reload.
4. Multiplayer service/private rooms: validated protocol, secure creation/join, membership/host enforcement and expiry.
5. Waiting room/public discovery: controller assignment, compatibility, readiness, public filters and full/expired guards.
6. Two-browser proof: sequenced controller exchange and verified synchronized execution, including delay/jitter cases.
7. Recovery: reconnect, latency diagnostics, disconnect releases and synchronization improvements; investigate rollback feasibility.
8. Saves/settings/deployment: supported saves, production security, end-to-end tests on separate devices and networks.

Keep every phase independently testable. Pass each gate before proceeding. Placeholder interfaces are not completed functionality.

## Current implementation status

Foundation and local library implemented. Local ROMs remain in IndexedDB, hashes deduplicate imports, favorites/search/export/removal work, guest identity/name are local. A pinned self-hosted EmulatorJS player and explicit production offline package are implemented. Emulator-native browser save-state storage and save import/export are available; separate application save management remains planned. The independent Socket.IO service and private waiting rooms are implemented, including invitation/code joins, controller slots, local-ROM/profile matching, readiness, bounded reconnection and expiry. Session start is intentionally blocked server-side and in the UI until synchronization is verified. Public lobby creation, filtered/paginated discovery, occupancy/readiness display and safe joins are implemented. Private rooms and credentials are excluded from discovery. Gameplay synchronization remains unimplemented and is labeled accordingly. See MULTIPLAYER.md for setup and bounds. The original diagnostic ROM verifies basic rendering/controller behavior; real-game and physical-gamepad compatibility remain separate validation tasks.
