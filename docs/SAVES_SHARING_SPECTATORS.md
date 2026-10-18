# Saves, controller mappings, game sharing and spectators

## Local save management

Start a local game, then use **Save now** below the emulator. Each snapshot has a
name, date, ROM hash and emulator profile. Rename its name field, choose **Load**
and confirm to replace current progress, **Export** for a `.genesis-save` backup,
or **Delete** and confirm to remove it. Settings → Save states lists snapshots
across games and imports backups. Import checks the file size, format, ROM identity,
profile and SHA-256 checksum before storage; loading is limited to the exact game.

These snapshots are stored in the separate `genesis-arcade-saves` IndexedDB database.
Existing EmulatorJS toolbar saves/SRAM remain available through its native toolbar;
they are not silently migrated or deleted. Raw native save files are not the app's
`.genesis-save` backup format. State compatibility remains tied to the pinned core;
this is a resume feature, not proof of deterministic state restoration for netplay.

## Controller remapping

Local play retains EmulatorJS's **Control Settings** toolbar. Online host and player
two can open **Remap controller** below the picture, choose a keyboard button and
press its replacement, or choose a standard gamepad button index. Changes are stored
in that browser and loaded for later sessions; reset restores defaults. Selecting a
key already assigned moves it to the new action. Escape cancels key capture. Held
inputs are released when mappings change, focus is lost or a session ends. Stick
axes retain their directional mapping. Shared keyboard retains its explicit fixed
two-player layout. Physical gamepad testing remains device-dependent.

## Direct ROM sharing

Select a game as host in the waiting room, then choose **Offer ROM to Player 2**
(the label follows controller swaps). The other player sees the file name, size
and hash, and explicitly chooses **Download to my library** or **Decline**. A
successful download is SHA-256 checked before import; then select that game in
the waiting room and ready up normally. The recipient can export the received ROM
through its normal library game details. Only share games you may distribute.

The separate ordered WebRTC data channel sends bounded 16 KB chunks with buffered
amount backpressure, a 32 MB maximum and final size/hash checks. Transfers are not
resumable; leave/rejoin and offer again after a failed connection. Disconnecting
closes the channels and discards partial memory buffers. These files do not pass
through Socket.IO or get stored by the room server. If WebRTC uses a TURN relay,
its encrypted peer traffic can pass through that relay.

## Spectators

Private rooms offer **Join as spectator** beside Join Room. Public lobbies offer
**Watch**, even when both player seats are full. Four separate spectator seats are
available, including reconnect reservations. Watching requires no local ROM or
ready confirmation. The host streams video and emulator audio to each spectator;
select **Enable sound** for browser audio playback. The host's upload cost grows
with viewer count. Spectators are visible to room members; discovery exposes counts.

Spectators cannot select a game, ready, swap positions, start/stop games or use the
controller signaling channel. Spectator joining, leaving, disconnecting or reconnecting
does not reset player readiness or end the active epoch. A host/player disconnect
still ends gameplay as before. Private codes/invitations follow the same validation
as player joins. All new room peer signaling is restricted to a current member and
the current host, with server-supplied sender identity, strict schemas and quotas.

Deploy the room server first, then the frontend. New spectator/peer events require
the updated server; existing room state is in memory and expires on server restart.
Test different devices/networks with your TURN configuration before broader rollout.

## Verification

Local browser checks used separate host and recipient origins so the recipient
started with an empty library. Quickdraw Duel transferred over the room data
channel and appeared in the recipient's library only after hash verification.
A third browser tab received host picture/audio as a spectator; leaving and
rejoining kept both player connections active. The recipient's B key was remapped
to Z through the UI. The local player created a roughly 1 MB snapshot and accepted
restoration through the inline confirmation. Automated checks cover save-file
round trips/tampering, bridge sender/ROM restrictions, transfer length/hash failures,
spectator capacity/permissions/reconnection and the existing multiplayer suite.
These checks do not certify physical gamepads or every commercial ROM.

See the [browser check record](features-browser-proof.json),
[spectator picture](spectator-proof.png), [verified transfer](rom-transfer-proof.png)
and [loaded snapshot](save-management-proof.png).

### Spectator media timing fix

Spectator peers reserve send-only video/audio transceivers in their first offer.
When the host emulator starts or restarts, its tracks replace those sender tracks
without requiring another offer. ICE candidates arriving before their offer are
buffered with bounded memory. Playback is reported as live only after the video
loads/plays, and audio is enabled only after an audio track is active. A spectator
can retry its peer connection without stopping the player session; a missing
picture produces a timeout explanation rather than an indefinitely blank player.

Regression checks cover reserved media slots, late track attachment, replacement
and removal on restart, serialized updates, and early ICE order/bounds. Local
browser checks verified a viewer connected before emulator start, leaving/rejoining
an active game, and the retry button while Player 2 stayed connected. This fix
changes only frontend code: deploy Vercel, then have the host and spectators reload
and start a fresh game so both sides use the new connection code. Separate networks
may still require the configured TURN service.

[Recovered spectator playback](spectator-recovery-proof.png) records the local
retry check with picture visible and audio enabled.
