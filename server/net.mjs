// Network helpers for the custom server: LAN address discovery (for the QR
// code) and a cached self-signed certificate for HTTPS in development.
//
// Why HTTPS in dev: phones only expose gyroscope data (DeviceOrientationEvent)
// to secure contexts, and http://192.168.x.x is not one.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Interfaces that are never the Wi-Fi/Ethernet a phone can reach.
const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|zt|tailscale|wg|lo)/i;

// Private IPv4 ranges, best first: home Wi-Fi is usually 192.168.x.x.
function rank(ip) {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 3;
}

/** LAN IPv4 addresses of this machine, the most likely reachable one first. */
export function lanAddresses() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      found.push({ ip: a.address, virtual: VIRTUAL_IFACE.test(name) });
    }
  }
  found.sort((a, b) => a.virtual - b.virtual || rank(a.ip) - rank(b.ip));
  return found.map((f) => f.ip);
}

/**
 * Self-signed cert covering localhost and every current LAN IP. Cached in
 * .certs/ and regenerated when the IP list changes (e.g. a new Wi-Fi network),
 * so the phone only has to accept the warning again when the address changes.
 */
export async function devCertificate(rootDir) {
  const dir = path.join(rootDir, ".certs");
  const meta = path.join(dir, "meta.json");
  const ips = ["127.0.0.1", ...lanAddresses()];
  const key = ips.join(",");

  try {
    const m = JSON.parse(fs.readFileSync(meta, "utf8"));
    if (m.key === key && new Date(m.expires) > new Date()) {
      return {
        key: fs.readFileSync(path.join(dir, "key.pem")),
        cert: fs.readFileSync(path.join(dir, "cert.pem")),
      };
    }
  } catch {
    // no cache yet
  }

  const { default: selfsigned } = await import("selfsigned");
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 1);
  const pems = await selfsigned.generate([{ name: "commonName", value: "gyro-dev.local" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: "localhost" }, ...ips.map((ip) => ({ type: 7, ip }))],
      },
    ],
  });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "key.pem"), pems.private);
  fs.writeFileSync(path.join(dir, "cert.pem"), pems.cert);
  fs.writeFileSync(meta, JSON.stringify({ key, expires: notAfter.toISOString() }));
  return { key: pems.private, cert: pems.cert };
}
