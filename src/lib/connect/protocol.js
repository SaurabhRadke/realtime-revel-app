// Wire format shared by the phone (controller) and the desktop (host).
//
// Input is sent ~60 times a second, so it goes as a fixed 28-byte binary
// packet instead of JSON (~5x smaller, no parsing). The same bytes travel over
// the WebRTC DataChannel or, as a fallback, the Socket.IO relay.
//
//   INPUT (28 B)                     PING / PONG (12 B)
//   0  u8   type = 1                 0  u8   type = 2 | 3
//   1  u8   flags                    1  u8   0
//   2  u16  seq                      2  u16  id
//   4  f32  qx  \                    4  f64  sender timestamp (ms)
//   8  f32  qy   | device attitude
//   12 f32  qz   | (unit quaternion,
//   16 f32  qw  /   earth frame)
//   20 f32  joyX  -1..1 (right +)
//   24 f32  joyY  -1..1 (forward +)

export const PKT_INPUT = 1;
export const PKT_PING = 2;
export const PKT_PONG = 3;

export const FLAG_GYRO = 1; // quaternion is valid
export const FLAG_RUN = 2; // run button held
export const FLAG_TORCH = 4; // torch should follow the phone (gyro aiming on)

const INPUT_BYTES = 28;
const PING_BYTES = 12;

export function encodeInput({ seq, flags, q, joyX, joyY }) {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, PKT_INPUT);
  v.setUint8(1, flags);
  v.setUint16(2, seq & 0xffff, true);
  v.setFloat32(4, q[0], true);
  v.setFloat32(8, q[1], true);
  v.setFloat32(12, q[2], true);
  v.setFloat32(16, q[3], true);
  v.setFloat32(20, joyX, true);
  v.setFloat32(24, joyY, true);
  return buf;
}

export function encodePing(type, id, time) {
  const buf = new ArrayBuffer(PING_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, type);
  v.setUint16(2, id & 0xffff, true);
  v.setFloat64(4, time, true);
  return buf;
}

// Socket.IO may hand us an ArrayBuffer, a Uint8Array or a Node-style Buffer view.
function toView(data) {
  if (data instanceof ArrayBuffer) return new DataView(data);
  if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/** Returns a decoded packet object or null for anything malformed. */
export function decode(data) {
  const v = toView(data);
  if (!v || v.byteLength < 1) return null;
  const type = v.getUint8(0);
  if (type === PKT_INPUT && v.byteLength >= INPUT_BYTES) {
    const q = [v.getFloat32(4, true), v.getFloat32(8, true), v.getFloat32(12, true), v.getFloat32(16, true)];
    const joyX = v.getFloat32(20, true);
    const joyY = v.getFloat32(24, true);
    if (![...q, joyX, joyY].every(Number.isFinite)) return null;
    return { type, flags: v.getUint8(1), seq: v.getUint16(2, true), q, joyX, joyY };
  }
  if ((type === PKT_PING || type === PKT_PONG) && v.byteLength >= PING_BYTES) {
    return { type, id: v.getUint16(2, true), time: v.getFloat64(4, true) };
  }
  return null;
}

/** True if `seq` is newer than `last`, with 16-bit wrap-around. */
export function seqNewer(seq, last) {
  return ((seq - last) & 0xffff) < 0x8000 && seq !== last;
}

export const ROOM_CODE_RE = /^[A-Z2-9]{4}$/;
