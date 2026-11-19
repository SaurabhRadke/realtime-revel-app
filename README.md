# The Old Ground — with a phone controller

A vintage 3D night scene (Next.js + three.js). Scan a QR code and your phone
becomes the controller: **joystick to walk, point the phone to aim the torch.**

## Run it

```bash
npm install
npm run dev          # custom server: Next.js + Socket.IO on one port, HTTPS
```

Open `https://<your-LAN-IP>:3000` (printed in the terminal) on the desktop,
click **Connect phone**, scan the QR. Both devices must be on the same Wi-Fi.

- The dev server uses a self-signed certificate (`.certs/`, auto-generated).
  Accept the warning once on each device. HTTPS is required because phones only
  expose the gyroscope to secure pages. `npm run dev -- --http` gives plain http
  (the joystick works, aiming doesn't).
- iPhone: tap **Start**, then allow Motion & Orientation access.

## How it works

```
Desktop "/"                 server.mjs (Next + Socket.IO)          Phone "/controller"
host:open ───────────────▶  room "K7QX" + host token
QR: https://ip:3000/controller?room=K7QX      ◀────────────── controller:join
◀──────── WebRTC offer / answer / ICE relayed over the socket ────────▶
◀═════════ RTCDataChannel (unordered, no retransmits) ═════════ 28-byte input @ 60 Hz
◀ ─ ─ ─ ─ ─ socket relay fallback (same bytes) if P2P can't form ─ ─ ─
```

- **Signaling + rooms:** Socket.IO on a custom Next.js server (`server.mjs`,
  `server/rooms.mjs`). Route handlers can't hold WebSockets, so the socket lives
  next to Next in one process.
- **Fast path:** WebRTC DataChannel, UDP-like. A late input packet is useless,
  so it's never retransmitted. Sequence numbers drop out-of-order packets.
- **LAN P2P fix:** browsers hide local IPs behind `*.local` mDNS names that many
  phones can't resolve. The server swaps them for the client's real LAN address.
- **Gyro:** `deviceorientation` → quaternion on the phone (no gimbal lock), slerped
  on the desktop; the phone's top edge is the torch. Yaw is incremental, pitch is
  absolute from the calibrated "level" (Recenter).
- **Binary protocol:** `src/lib/connect/protocol.js`, 28 bytes per input packet.
- Rooms survive a desktop reload (token in sessionStorage, 30 s grace).
  `MAX_CONTROLLERS` (default 1) sets how many phones per room.

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
