// Custom Next.js server: one process, one port, serving
//   - the Next.js app (desktop scene at "/", phone controller at "/controller")
//   - Socket.IO at /socket.io (rooms + WebRTC signaling + input relay fallback)
//
// Next.js route handlers can't hold WebSocket connections (they end when the
// response is sent), so the socket server lives here. Next's own upgrade
// handler only claims its HMR path and leaves other upgrades to us.
//
//   npm run dev     -> https://<lan-ip>:3000 with a self-signed cert (HTTPS lets the
//                      phone keep its screen awake). `npm run dev -- --http` for plain http.
//   npm run start   -> plain http; put it behind a TLS-terminating host
//                      (Render, Railway, Fly.io, a VPS with Caddy...).
//   npm run start:https -> production build with the self-signed cert, for LAN testing.

import http from "node:http";
import https from "node:https";
import next from "next";
import { Server } from "socket.io";
import { attachRooms } from "./server/rooms.mjs";
import { devCertificate, lanAddresses } from "./server/net.mjs";

// Flags instead of `NODE_ENV=production node ...` so the npm scripts work in
// every shell (Windows cmd/PowerShell can't set env vars inline).
const args = new Set(process.argv.slice(2));
if (args.has("--production")) process.env.NODE_ENV = "production";
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0"; // listen on the LAN, not just localhost
const useHttps = args.has("--https") || (dev ? process.env.DEV_HTTPS !== "0" && !args.has("--http") : process.env.HTTPS === "1");

const tls = useHttps ? await devCertificate(process.cwd()) : null;
const server = tls ? https.createServer(tls) : http.createServer();

const app = next({ dev, hostname: "localhost", port, httpServer: server });
const handle = app.getRequestHandler();
await app.prepare();

const scheme = tls ? "https" : "http";
const lan = lanAddresses();

// The desktop asks for this to build the QR when it is opened via localhost
// (a phone can't reach "localhost"). PUBLIC_URL overrides it, e.g. a tunnel.
server.on("request", (req, res) => {
  if (req.url === "/api/connect-info") {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(
      JSON.stringify({
        publicUrl: process.env.PUBLIC_URL || null,
        lanOrigins: lan.map((ip) => `${scheme}://${ip}:${port}`),
      }),
    );
    return;
  }
  if (req.url?.startsWith("/socket.io")) return; // handled by engine.io
  handle(req, res);
});

const io = new Server(server, {
  path: "/socket.io",
  serveClient: false,
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 10_000,
  pingTimeout: 8_000,
  // Same-origin in practice; allow LAN origins in dev for tools/tunnels.
  cors: dev ? { origin: true } : undefined,
});
attachRooms(io);

server.listen(port, host, () => {
  console.log(`\n  ▲ Gyro server (${dev ? "dev" : "production"})`);
  console.log(`  - Local:   ${scheme}://localhost:${port}`);
  for (const ip of lan) console.log(`  - Network: ${scheme}://${ip}:${port}`);
  if (tls) console.log("  (self-signed certificate: accept the browser warning once on each device)\n");
});
