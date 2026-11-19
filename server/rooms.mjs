// Room manager and signaling relay (Socket.IO).
//
// Roles
//   host        the desktop showing the 3D scene. Creates a room, shows the QR.
//   controller  a phone that scanned the QR. Sends gyro + joystick input.
//
// The server never interprets input. It
//   1. pairs controllers with a host (rooms, capacity, host token),
//   2. relays WebRTC signaling (offer/answer/ICE) so the two can go peer-to-peer,
//   3. relays binary input packets itself while P2P is not up (fallback path).
//
// Events (client -> server, all JSON unless noted)
//   host:open        {roomId?, token?}            ack {ok, roomId, token, maxControllers}
//   host:close
//   host:kick        {peerId}
//   controller:join  {roomId, name}               ack {ok, error?}
//   signal           {to, data}                   WebRTC SDP / ICE, relayed to `to`
//   pkt              (to?, ArrayBuffer)           binary fast path (input / ping / pong)
//   msg              (to?, object)                reliable JSON (actions, feedback)
// Events (server -> client)
//   peer:joined {peerId, name}  peer:left {peerId}        (to host)
//   host:online  host:offline  room:closed {reason}        (to controllers)
//   signal {from, data}   pkt (from, buf)   msg (from, obj)

import crypto from "node:crypto";
import { lanAddresses } from "./net.mjs";

const MAX_CONTROLLERS = Number(process.env.MAX_CONTROLLERS ?? 1);
const HOST_GRACE_MS = 30_000; // keep the room this long if the host reloads
const MAX_PKT_BYTES = 64;
const MAX_MSG_BYTES = 2_048;
const MAX_SIGNAL_BYTES = 16_384;
const PKT_RATE = 150; // packets per second per socket, generous for 60 Hz input

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** @type {Map<string, {id:string, token:string, host:string|null, controllers:Map<string,{name:string}>, closeTimer:any}>} */
const rooms = new Map();

function newRoomId() {
  for (;;) {
    let id = "";
    const bytes = crypto.randomBytes(4);
    for (const b of bytes) id += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!rooms.has(id)) return id;
  }
}

const cleanName = (n) =>
  String(n ?? "Phone")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .slice(0, 24) || "Phone";

// ---------- LAN WebRTC helper: mDNS candidate rewriting ----------
// Browsers hide local IPs in ICE candidates behind random "<uuid>.local" mDNS
// names. Many phones can't resolve those, so on a LAN the P2P link would
// never form. But the server already sees each client's real LAN address
// (it's the TCP peer of the socket), so for private-network clients we swap
// the mDNS name for that address. The UDP port in the candidate is real.
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

function clientLanAddress(socket) {
  let ip = socket.handshake.address ?? "";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  // The desktop usually runs on this machine and connects via localhost:
  // other devices reach it on its LAN address instead.
  if (ip === "127.0.0.1" || ip === "::1") return lanAddresses()[0] ?? null;
  return PRIVATE_V4.test(ip) ? ip : null;
}

function rewriteMdnsCandidate(data, ip) {
  const line = data?.candidate?.candidate;
  if (!ip || typeof line !== "string" || !line.includes(".local ")) return data;
  const parts = line.split(" ");
  // candidate:<foundation> <component> <proto> <priority> <address> <port> typ <type> ...
  if (parts.length < 8 || !parts[4].endsWith(".local")) return data;
  parts[4] = ip;
  return { ...data, candidate: { ...data.candidate, candidate: parts.join(" ") } };
}

// Constant-time token comparison (hash first so lengths always match).
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const h = (s) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

function byteSize(v) {
  try {
    return Buffer.byteLength(JSON.stringify(v) ?? "");
  } catch {
    return Infinity;
  }
}

// Simple token bucket so a misbehaving client can't flood the relay.
function makeLimiter(rate) {
  let tokens = rate;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(rate, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function attachRooms(io) {
  const closeRoom = (room, reason) => {
    clearTimeout(room.closeTimer);
    io.to(`c:${room.id}`).emit("room:closed", { reason });
    for (const id of room.controllers.keys()) {
      const s = io.sockets.sockets.get(id);
      if (s) {
        s.leave(`c:${room.id}`);
        s.data.roomId = null;
      }
    }
    rooms.delete(room.id);
  };

  io.on("connection", (socket) => {
    socket.data.role = null;
    socket.data.roomId = null;
    const allowPkt = makeLimiter(PKT_RATE);

    const myRoom = () => (socket.data.roomId ? rooms.get(socket.data.roomId) : undefined);

    // ---------- Host ----------
    socket.on("host:open", (req, ack) => {
      if (typeof ack !== "function") return;
      if (socket.data.role === "controller") return ack({ ok: false, error: "wrong_role" });

      let room = req?.roomId ? rooms.get(String(req.roomId).toUpperCase()) : undefined;
      const resuming = !!room && safeEqual(req?.token, room.token);

      if (!resuming) {
        room = {
          id: newRoomId(),
          token: crypto.randomBytes(16).toString("hex"),
          host: null,
          controllers: new Map(),
          closeTimer: null,
        };
        rooms.set(room.id, room);
      }

      // A different live tab already owns it: take over, the old one is stale.
      if (room.host && room.host !== socket.id) {
        io.sockets.sockets.get(room.host)?.emit("room:closed", { reason: "taken_over" });
      }
      clearTimeout(room.closeTimer);
      room.host = socket.id;
      socket.data.role = "host";
      socket.data.roomId = room.id;

      ack({ ok: true, roomId: room.id, token: room.token, maxControllers: MAX_CONTROLLERS });

      // Re-introduce controllers that stayed connected through a host reload.
      io.to(`c:${room.id}`).emit("host:online");
      for (const [peerId, c] of room.controllers) socket.emit("peer:joined", { peerId, name: c.name });
    });

    socket.on("host:close", () => {
      const room = myRoom();
      if (room && room.host === socket.id) closeRoom(room, "host_closed");
      socket.data.roomId = null;
    });

    socket.on("host:kick", (req) => {
      const room = myRoom();
      if (!room || room.host !== socket.id) return;
      const peer = io.sockets.sockets.get(String(req?.peerId));
      if (!peer || !room.controllers.has(peer.id)) return;
      room.controllers.delete(peer.id);
      peer.leave(`c:${room.id}`);
      peer.data.roomId = null;
      peer.emit("room:closed", { reason: "kicked" });
      socket.emit("peer:left", { peerId: peer.id });
    });

    // ---------- Controller ----------
    socket.on("controller:join", (req, ack) => {
      if (typeof ack !== "function") return;
      if (socket.data.role === "host") return ack({ ok: false, error: "wrong_role" });
      const room = rooms.get(String(req?.roomId ?? "").toUpperCase());
      if (!room) return ack({ ok: false, error: "not_found" });
      if (!room.controllers.has(socket.id) && room.controllers.size >= MAX_CONTROLLERS) {
        return ack({ ok: false, error: "full" });
      }
      const name = cleanName(req?.name);
      room.controllers.set(socket.id, { name });
      socket.data.role = "controller";
      socket.data.roomId = room.id;
      socket.join(`c:${room.id}`);
      ack({ ok: true, roomId: room.id, hostOnline: !!room.host });
      if (room.host) io.to(room.host).emit("peer:joined", { peerId: socket.id, name });
    });

    // ---------- Relays ----------
    // Resolve who a message may go to: controllers only talk to their host,
    // hosts only to controllers in their own room.
    const target = (to) => {
      const room = myRoom();
      if (!room) return null;
      if (socket.data.role === "controller") return room.host;
      if (socket.data.role === "host" && room.controllers.has(to)) return to;
      return null;
    };

    const lanIp = clientLanAddress(socket);

    socket.on("signal", (req) => {
      if (byteSize(req?.data) > MAX_SIGNAL_BYTES) return;
      const to = target(req?.to);
      if (!to) return;
      io.to(to).emit("signal", { from: socket.id, data: req.data });
      // Also offer the de-obfuscated candidate; ICE simply uses whichever works.
      if (req.data?.kind === "ice") {
        const rewritten = rewriteMdnsCandidate(req.data, lanIp);
        if (rewritten !== req.data) io.to(to).emit("signal", { from: socket.id, data: rewritten });
      }
    });

    // Binary fast path. Controllers send pkt(buf); hosts send pkt(to, buf).
    socket.on("pkt", (a, b) => {
      if (!allowPkt()) return;
      const [to, buf] = socket.data.role === "host" ? [a, b] : [null, a];
      if (!Buffer.isBuffer(buf) || buf.length > MAX_PKT_BYTES) return;
      const dest = target(to);
      // volatile: if the receiver is congested, drop rather than queue stale input
      if (dest) io.to(dest).volatile.emit("pkt", socket.id, buf);
    });

    socket.on("msg", (a, b) => {
      const [to, obj] = socket.data.role === "host" ? [a, b] : [null, a];
      if (!obj || typeof obj !== "object" || byteSize(obj) > MAX_MSG_BYTES) return;
      const dest = target(to);
      if (dest) io.to(dest).emit("msg", socket.id, obj);
    });

    // ---------- Leaving ----------
    socket.on("disconnect", () => {
      const room = myRoom();
      if (!room) return;
      if (socket.data.role === "host" && room.host === socket.id) {
        room.host = null;
        io.to(`c:${room.id}`).emit("host:offline");
        room.closeTimer = setTimeout(() => closeRoom(room, "host_gone"), HOST_GRACE_MS);
      } else if (socket.data.role === "controller" && room.controllers.delete(socket.id)) {
        if (room.host) io.to(room.host).emit("peer:left", { peerId: socket.id });
      }
    });
  });
}
