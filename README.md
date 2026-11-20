# The Old Ground — with a phone controller

A vintage 3D night scene (Next.js + three.js). Scan a QR code and your phone
becomes the controller: **left thumb joystick to walk, right thumb swipe to look
and swing the torch** (mobile-shooter style). Up to 4 phones play "Lanterns &
Keys", a treasure hunt.

## Run it

```bash
npm install
npm run dev          # custom server: Next.js + Socket.IO on one port, HTTPS
```

Open `https://<your-LAN-IP>:3000` (printed in the terminal) on the desktop,
click **Connect phone**, scan the QR. Both devices must be on the same Wi-Fi.

- The dev server uses a self-signed certificate (`.certs/`, auto-generated).
  Accept the warning once on each device. HTTPS lets the phone keep its screen
  awake (Wake Lock). `npm run dev -- --http` gives plain http, which also works.

## The game

Pick a mission in the lobby (on the screen or any phone), press **Start**. A
briefing types out the story and the goals; it ends when every player pressed
**Ready** (or after a minute).

| Mission | Players | Goal |
| --- | --- | --- |
| **The Three Keys** | 1–4, everyone for themselves | Coins on the roads; three keys hidden in the dark, revealed only by torchlight (fireflies and the key-sense meter help). All three unlock the chest at the crossroads: first to open it ends the round. Most gold wins. |
| **Lamps Out** | 1–4, one team | Every street lamp is out. Five oil flasks are hidden like the keys; carry them (one at a time) to Old Wick at the crossroads. Each flask relights the lamps nearest the crossroads first. Light the town, open the chest together; up to three stars for time to spare. |

**Townsfolk** (walk up, press *Talk* on the phone or **E** on the keyboard;
answers with 1–4 on the keyboard). Each player has their own conversation; the
big screen shows their lines over their heads, typed out.

- **Old Wick** (crossroads): free hints, "fireflies to the north-east, about 25 paces off". Takes the oil in Lamps Out.
- **Madame Hollow** (tent, west road): a *vision* for 3 gold, a pillar of light over the nearest hidden prize.
- **Ember** (cart, east road): a brass compass that floats over you pointing the way (4), torch oil for a brighter, longer beam (2), a swift tonic (3).

Gold is score *and* money, so spending it is a choice.

Code: rules `src/components/scene/game.js`, mission texts `missions.js`,
townsfolk dialogue `npcs.js`, where everything stands `townProps.js`, the 3D
side `Props.jsx` + `Treasure.jsx`.

### Models

Source files live in `3d-assets/` (not committed). The game loads web-sized
copies from `public/models/`:

```bash
node scripts/optimize-models.mjs   # houses, lamp, moon, torch, characters, collectables
node scripts/optimize-props.mjs    # 3d-assets/game-assets: townsfolk + props (simplified, WebP)
```

`optimize-props.mjs` simplifies the meshes (some scans are 500k triangles) and
writes `src/components/scene/propModels.json`. The signpost and crates are
generated in code; the UI portraits and item icons in `public/ui/` are renders
of the game's own models.

## How it works

```
Desktop "/"                 server.mjs (Next + Socket.IO)          Phone "/controller"
host:open ───────────────▶  room "K7QX" + host token
QR: https://ip:3000/controller?room=K7QX      ◀────────────── controller:join
◀──────── WebRTC offer / answer / ICE relayed over the socket ────────▶
◀═════════ RTCDataChannel (unordered, no retransmits) ═════════ 10-byte input @ up to 60 Hz
◀ ─ ─ ─ ─ ─ socket relay fallback (same bytes) if P2P can't form ─ ─ ─
```

- **Signaling + rooms:** Socket.IO on a custom Next.js server (`server.mjs`,
  `server/rooms.mjs`). Route handlers can't hold WebSockets, so the socket lives
  next to Next in one process.
- **Fast path:** WebRTC DataChannel, UDP-like. A late input packet is useless,
  so it's never retransmitted. Sequence numbers drop out-of-order packets.
- **LAN P2P fix:** browsers hide local IPs behind `*.local` mDNS names that many
  phones can't resolve. The server swaps them for the client's real LAN address.
- **Look pad:** the right half of the phone is a swipe area. The phone sends
  running look totals (not per-packet deltas), so a lost packet costs nothing;
  the desktop eases the turn in over a few frames for a smooth view.
- **Binary protocol:** `src/lib/connect/protocol.js`, 10 bytes per input packet.
- Rooms survive a desktop reload (token in sessionStorage, 30 s grace).
  `MAX_CONTROLLERS` (default 4) sets how many phones per room.

## Deploy

Vercel's serverless functions can't keep WebSocket connections open, so deploy
this as a long-running Node server: Render, Railway, Fly.io or a VPS.

```bash
npm run build
npm start            # production, plain http on $PORT (host adds TLS)
npm run start:https  # production + self-signed HTTPS, to test with a phone on your LAN
```

The host terminates TLS, which gives the phone the HTTPS it needs. STUN is
configured, so P2P works across networks where NAT allows it. Otherwise it
falls back to the relay automatically.
APP IS LIVE ON Available at your primary URL https://realtime-revel-app.onrender.com