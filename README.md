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

## How it works

```
Desktop "/"                 server.mjs (Next + Socket.IO)          Phone "/controller"
host:open ───────────────▶  room "K7QX" + host token
QR: https://ip:3000/controller?room=K7QX      ◀────────────── controller:join
◀──────── WebRTC offer / answer / ICE relayed over the socket ────────▶
◀═════════ RTCDataChannel (unordered, no retransmits) ═════════ 10-byte input @ 30 Hz
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