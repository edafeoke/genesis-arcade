# Multiplayer rooms and gameplay

**Current playable mode:** host-authoritative streaming is implemented. See [setup, controls, security boundaries and validation](HOST_STREAMING.md). Start Game now invokes this separate mode when advertised by the server. Deterministic two-core synchronization and rollback remain gated.

The waiting-room design and historical baseline checks below remain useful; references to disabled Start Game describe the earlier prototype.

# Private-room networking prototype

## Available

A separate Socket.IO/TypeScript service supports two-player private room creation, code/invitation joins, authoritative waiting-room snapshots, Player 1/2 assignment, local ROM metadata selection, compatibility checks, ready states, leave/host closure, room expiry, RTT measurement and credential-based reconnection.

**No synchronized game session starts.** The UI disables Start Game, and the service rejects even a fully ready host with `SYNC_UNAVAILABLE`. Controller input exchange, deterministic execution, rollback, in-game recovery and competitive play remain unimplemented. Matching metadata is not proof of synchronized gameplay.

## Local development

Run in separate terminals:

```sh
pnpm dev
pnpm server:dev
```

Open Play online, then Connect to multiplayer. The frontend in development defaults to the current hostname on port 4001. The service defaults to loopback and accepts frontend origins `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:3100`, and `http://127.0.0.1:3100`.

The service only connects after the user asks. It stays connected while navigating the dashboard; single-player never depends on it. The service issues a private session credential saved in sessionStorage and uses the chosen display name. A browser guest UUID is not accepted as authentication. Multiple tabs must have independent session credentials to represent different players; duplicating a tab may copy sessionStorage and cause an intentional session takeover.

A host shares the ten-character code or Copy Invitation Link. Invitation secrets are put in the URL fragment and validated by the service; fragments do not become HTTP request paths. Codes themselves are bearer access credentials, so code-only joins are intentionally supported. A supplied invalid invitation token is rejected. Private room snapshots and health checks contain no invitation or reconnection secrets.

Both players select their own local ROM and confirm that the original game has the intended two-player mode. The service compares full SHA-256 hashes and a declared versioned emulator profile. Filename equality is never used. Mode confirmation is a player declaration, not a verified game catalog. Selecting another game, controller swaps or connection changes clear readiness. Removing a selected local ROM also clears its room selection once the library finishes loading.

Only the host can swap Player 1/2. When a guest leaves, their slot opens; when the host leaves, the room closes for both. Disconnected slots remain reserved for 60 seconds. Returning with the private credential restores membership and resets readiness. After that grace period a guest loses their slot or an absent host's room closes. Leaving while disconnected forgets the local room credential; the reserved server slot expires after the grace window. Reconnection is waiting-room recovery only.

## Protocol and bounds

Events: `room:create`, `room:join`, `room:game`, `room:ready`, `room:swap`, `room:leave`, `room:start`, `room:ping`. Every request requires an acknowledgement and strict schema validation, including rejecting unknown fields. Session authentication accepts only a bounded display name and optional server-issued credential. The service never accepts ROM or emulator-state fields. Valid payloads contain only room credentials, title, ROM hash, declared profile and a two-player confirmation.

Server-to-client: `session` (private credential/identity and restored snapshot), `room:update` (member-only state), `room:closed`, `room:error`, `session:replaced`. Snapshots contain only the two members' public room identity, name, slot, connection/readiness and selected metadata. A newer authenticated connection replaces an older connection using the same session secret; stale socket IDs lose authority.

- Codes use 10 independent cryptographically random symbols from a 32-character alphabet (50 bits); invitation/session secrets use 32 random bytes.
- Constant-time comparison is used for equal-length invitation secrets.
- WebSocket-only transport; ordinary room payloads limited to 4096 bytes. Streaming SDP uses a separate bounded schema and signaling quota; see HOST_STREAMING.md.
- Origin allowlist enforced at handshake, including WebSocket requests; no wildcard or arbitrary forwarded-IP trust.
- Per direct peer IP: 30 connection attempts/minute, 3 room creations/minute, 15 join attempts/minute, 300 packets/10 seconds. Each socket is also limited to 60 packets/10 seconds. Packet-rate violations disconnect.
- Maximum 500 rooms, 1000 sessions/connections and 10000 rate-limit buckets. Expired buckets are pruned.
- Rooms expire after 15 minutes without room activity, or two hours maximum. Sweeper runs every 5 seconds; room operations also check expiry before acting. Ping does not keep a room alive.
- The host/member checks run on the service, independently of disabled UI controls.

## Production configuration

The Next.js frontend and room service deploy separately. Build frontend with `NEXT_PUBLIC_MULTIPLAYER_URL=https://rooms.example.com` (a public origin, not a secret). If omitted in production, it uses the frontend origin, which requires a reverse proxy forwarding `/socket.io/` to the separate service.

```sh
NEXT_PUBLIC_MULTIPLAYER_URL=https://rooms.example.com pnpm build
pnpm server:build
NODE_ENV=production MULTIPLAYER_ORIGINS=https://arcade.example.com MULTIPLAYER_HOST=127.0.0.1 MULTIPLAYER_PORT=4001 pnpm server:start
```

Use a TLS reverse proxy providing HTTPS/WSS and WebSocket upgrades. Production service configuration rejects non-HTTPS frontend origins and requires an explicit allowlist. Local HTTP tests are not a verification of production TLS. Backend configuration comes from process environment variables; Next.js `.env.local` loading does not automatically load those variables into the independent server. With a direct container listener, intentionally set `MULTIPLAYER_HOST=0.0.0.0` and configure network exposure at deployment.

This version uses **one in-memory service instance**. A restart expires all rooms/credentials; the browser receives a fresh session and an explanation. Deploying multiple independent instances will not share rooms. Persistence, distributed coordination, proxy-aware quotas and broader abuse controls require a later deployment design. Current IP limits apply to the reverse proxy's address unless a trusted proxy integration is designed; do not blindly trust forwarded headers.

There is no HTTP room-list endpoint; public discovery uses a validated Socket.IO request. `/health` exposes only service availability and `syncAvailable:false`. No ROM files, invitation tokens or session credentials are logged by application code.

## Verification

```sh
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm server:build
```

Room-store tests cover credential shape/secrecy, invalid invitations, full rooms, membership and host permissions, ROM/profile mismatches, readiness invalidation, the synchronization gate, reconnection, stale sockets, grace/idle/hard expiry, leaving, schemas, rate windows and capacity.

Real Socket.IO integration tests open local WebSocket connections and cover creation/join/matching/readiness, slot swaps and leaving, origin rejection, malformed/prototype event names, ROM-field rejection, credential-based restoration, IP creation limits and oversized-packet disconnects. Browser/device and network checks are recorded separately; these are not synchronized gameplay tests.

### Browser smoke check

Two browser tabs connected to the independent service. The host created a room; the second guest joined by code. Both selected the locally stored diagnostic ROM and saw matching full hashes/declared profiles. Host controller swaps propagated to the guest. Reloading the guest produced a disconnect/reserved-slot notice on the host; reconnecting restored the same room and swapped slot. Host departure closed the room for the guest.

The single-player diagnostic's multiplayer confirmation was deliberately left unchecked: Ready stayed disabled and no multiplayer compatibility claim was made for it. Synthetic game metadata exercises full readiness and start rejection in automated tests. The browser tool rejected copied-invitation navigation as an invalid URL; actual invitation-token joins are covered by the Socket.IO integration tests, but the full browser invitation-link path remains unverified.

Stopped the room service and then launched the local Genesis player; the diagnostic still rendered successfully. The new room UI introduces no multiplayer dependency into local emulation. A disconnected player can also choose Leave Session to forget the local reconnect credential and close the connection; the service releases any remaining reserved slot after its grace window. This does not falsely acknowledge an offline server-side leave.


## Public lobbies

The Public Lobbies tab provides public creation, title filtering, live occupancy/readiness, availability, pagination and joins. A local game is required to create a public room. Selecting Public Lobbies and creating is explicit; private rooms remain private and cannot be converted through metadata changes.

`room:create` accepts either `{}`/`{visibility:"private"}` or `{visibility:"public",game:<validated metadata>}`. Public rooms receive a separate opaque UUID discovery ID. `lobby:list` accepts a trimmed title query up to 80 characters and offset 0–500. It returns at most 50 records, plus matching public count and offset. `lobby:join` accepts only a UUID and independently checks visibility, current game selection, host presence, expiry, membership and reserved capacity.

Public records contain exactly: discovery ID, game title, member count, ready count, capacity, waiting/full/host-away status, host-declared two-player-mode confirmation and expiry. They exclude room codes, invitation/session secrets, player IDs/names, ROM hashes and emulator profiles. A game title is intentionally published by creating a public room. Only room members receive full compatibility metadata.

The browser refreshes every five seconds while the lobby tab is visible. Searches are debounced; stale query replies are ignored after effect cleanup. There are distinct disconnected, loading, empty, filtered-empty and error/retry states. Discovery is rate-limited to 30 requests/minute/socket and 300/minute/direct peer IP, in addition to existing packet limits. Room creation/join quotas are shared across private and public flows.

Full rooms remain visible with disabled join controls; disconnected guests still occupy reserved slots. Reconnecting hosts are unavailable. The authoritative service rechecks state at join time so cached listings cannot bypass guards. Guest departure reopens the room, host departure closes it, and expiry removes it. Clearing the host's game hides the public listing and rejects discovery-ID joins until a game is selected again.

A public lobby does not add a multiplayer mode to a Genesis game. Mode confirmation is a player declaration, not a compatibility certification. Synchronized gameplay and Start Game remain blocked for public rooms as for private rooms.

### Public-lobby browser smoke check

The host created a public room with the original local diagnostic fixture. A second tab discovered it without a code, received a no-match state for an unrelated filter, found it again with an uppercase title query, and joined the advertised waiting room. A third tab saw 2/2 occupancy, zero ready players and a disabled Full button. Closing the public room removed its listing after refresh. The host then created a private room; the public browser stayed empty. The diagnostic remained explicitly unverified for two-player mode and no synchronized gameplay was started.

Automated coverage additionally checks exact discovery field allowlists, private/credential/hash exclusion, pagination bounds, live state changes, cleared-game hiding, grace/idle expiry, stale/full joins and the discovery read quota. If rooms disappear while viewing a later page, the browser returns to the last available page instead of leaving an unreachable empty page.

## Synchronization gate status

The application now links to an isolated capability lab at `/sync-lab/index.html`. It loads one locally selected ROM into two emulator runtimes and exports measurements without sending ROM or state bytes to the service. The diagnostic established stable paused counters and repeated serialization, but immediate paused restoration did not match baseline bytes. Exact stepping is unverified. These are two-instance measurements inside one browser, not a completed two-browser input synchronization proof of concept.

See [emulator research and adapter requirements](EMULATOR_RESEARCH.md) and [raw measured evidence](emulator-capability-report.json). The next implementation gate is a controlled frontend/core adapter with synchronous frame stepping and verified state restoration. Gameplay input forwarding, delay scheduling, reconnection during emulation and rollback remain unimplemented. Existing waiting-room reconnect behavior does not imply gameplay reconnection.

An isolated Asyncify-aware loop adapter now demonstrates queued checkpoint restoration and one-frame progression in the VBlank-counting diagnostic. Full trace replay still differs by 1–5 serialized bytes across the measured runs; the determinism gate remains closed. Generated lab assets never replace the normal offline core. Follow the research document for reproduction and remaining validation.

The longer 120-step probe now records hashes at each step. Both measured runtimes diverged immediately on the first replay step after a byte-equal checkpoint restoration. The [per-step evidence](emulator-divergence-report.json) is preserved. This is still a local adapter investigation; no gameplay input transport or room-start bypass has been added.

A subsequent fixture-only experiment preserved the missing CPU bus-refresh timing value after restoration. Both runtimes then matched all 120 original step hashes and their final full state, while ordinary restoration still failed. See the [positive controlled report](emulator-refresh-proof-initial.json) and emulator research. The fix is restricted to a known diagnostic and a validated live CPU structure; it is not yet a general game adapter. Controller-port verification and two-browser input synchronization are still required before enabling Start Game.

The [coordination foundation](SYNCHRONIZATION_ADAPTER.md) now supplies a versioned adapter interface/operation queue and a tested delay-lockstep input buffer. It protects controller ownership, validates numbered full input states, stalls on gaps, suppresses duplicates, handles reordering and terminates disconnected/conflicting epochs. Two model peers matched 300-frame traces and full model-state checkpoints under simulated jitter. No live gameplay transport or concrete general EmulatorJS backend has been connected, and the service's existing membership checks, rate limits and start rejection remain unchanged.
