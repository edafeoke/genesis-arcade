# Deploy Genesis Arcade

Deploy the Next.js frontend on Vercel and the standalone room service on Render.
Local single-player and previously downloaded offline games do not depend on the
room service. No ROM files are sent to either multiplayer endpoint.

## 1. Frontend on Vercel

Import this GitHub repository as a Next.js project, with the repository root as
its root directory. Use:

- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm build:webpack`
- Output directory: leave the framework default
- Node.js: 22.x

Deploy and record the HTTPS production origin, for example
`https://genesis-arcade.vercel.app`. Use the actual project domain throughout these
steps. The offline generator uses `.next/BUILD_ID`, so it does not require the
prerendered homepage to remain in Next's private server output directory.

## 2. Room service on Render

In Render, choose **New → Blueprint**, connect this repository, and select its
`render.yaml`. Review the proposed service before creating it. The configuration
uses one free Node service and prompts for `MULTIPLAYER_ORIGINS`. Enter the exact
Vercel production origin with no trailing slash. Multiple trusted frontend origins
can be comma-separated; do not use a wildcard or include arbitrary preview domains.

The blueprint builds the TypeScript server, starts it on `0.0.0.0:10000`, enables
casual host streaming, and checks `/health`. It explicitly installs development
dependencies because TypeScript is required at build time. Keep one instance:
rooms and reconnection credentials live in process memory and are lost on restart.

After deployment, record its public HTTPS URL, for example
`https://genesis-arcade-rooms.onrender.com`. Opening its `/health` endpoint should
return `ok: true` and `service: "genesis-rooms"`. `syncAvailable: false` is expected:
casual gameplay uses host streaming, while deterministic netplay remains disabled.

Free services can sleep when idle, so the initial connection may require waking
the service and trying again. For always-on play, review Render's current paid
plans. See the [Blueprint reference](https://render.com/docs/blueprint-spec) and
[free-service limitations](https://render.com/docs/free).

## 3. Connect the frontend

In Vercel → Project → Settings → Environment Variables, set this for Production:

```text
NEXT_PUBLIC_MULTIPLAYER_URL=https://YOUR-ROOM-SERVICE.onrender.com
```

Redeploy the frontend after changing this value: `NEXT_PUBLIC_` settings are
compiled into the browser bundle. This URL is the server origin; do not append
`/socket.io/` or `/health`.

For Vercel preview deployments, explicitly allow their exact origins on the room
service and configure the Preview variable separately if you want them to connect.
A custom frontend domain must also be added to `MULTIPLAYER_ORIGINS` on Render.
Changing a Blueprint's existing `sync: false` value does not update its environment;
edit that variable in the Render dashboard and restart/redeploy the service.

## 4. Check the deployed connection

Run locally, replacing both URLs:

```sh
pnpm check:multiplayer https://YOUR-ROOM-SERVICE.onrender.com https://YOUR-APP.vercel.app
```

This verifies HTTP health, the origin allowlist, WebSocket negotiation and guest
session creation. It creates no rooms and sends no ROMs. It does not verify the
frontend's compiled URL, WebRTC media or game controls.

Open the deployed frontend in two browsers. In each, add the free Quickdraw Duel
demo from Play online. Create a private room in one, join its code in the other,
select the matching game, mark both players ready and choose Start Game. Confirm
that the guest receives video/audio and controls their assigned player. On one
computer, Shared keyboard lets both players use the host window; see
[controls](HOST_STREAMING.md). Also test public-room discovery and leaving a session.

Test other devices and networks before claiming internet gameplay is verified.
Some connections require a TURN relay. Set `NEXT_PUBLIC_RTC_ICE_SERVERS` in Vercel
to a JSON array of provider-supplied ICE servers and redeploy. Browser ICE settings
are public; use scoped, short-lived TURN credentials from an appropriate credential
service for a public rollout. Never put a TURN administration secret in a
`NEXT_PUBLIC_` variable.

## Troubleshooting

- **Frontend builds but multiplayer is offline:** confirm Render is running,
  `NEXT_PUBLIC_MULTIPLAYER_URL` is set, and Vercel was redeployed afterward.
- **Health works but WebSocket check fails:** check the exact frontend origin in
  `MULTIPLAYER_ORIGINS`, including scheme and hostname. Inspect Render logs.
- **Both players enter a room but media does not connect:** room signaling works;
  inspect WebRTC diagnostics and configure TURN for networks that need it.
- **Room disappears after deployment:** restarting the single in-memory service
  expires its rooms. Create a new room.
- **Old frontend behavior:** close older tabs, reload and refresh the optional
  offline download. If needed, clear the site's service worker/cache; deleting
  all site data also deletes locally stored games and saves, so export those first.
