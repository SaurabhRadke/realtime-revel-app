// Wire format shared by the phone (controller) and the desktop (host).
//
// Input is the only high-rate traffic, so it goes as a fixed 10-byte binary
// packet instead of JSON. Looking around (the right half of the phone, swiped
// like a mobile shooter) travels as two running totals rather than per-packet
// deltas: a lost or late packet then costs nothing, the next one carries the
// whole sum. The totals wrap at 16 bits; the host takes the wrapped
// difference. Same bytes over the WebRTC DataChannel or the Socket.IO relay.
//
//   INPUT (10 B)                      PING / PONG (12 B)
//   0  u8   type = 1                  0  u8   type = 2 | 3
//   1  u8   flags                     1  u8   0
//   2  u16  seq                       2  u16  id
//   4  i16  lookX  total turn right   4  f64  sender timestamp (ms)
//   6  i16  lookY  total look up
//      (both in LOOK_UNIT radians, wrapping)
//   8  i8   joyX  -127..127 (right +)
//   9  i8   joyY  -127..127 (forward +)

export const PKT_INPUT = 1;
export const PKT_PING = 2;
export const PKT_PONG = 3;

export const FLAG_RUN = 2; // sprint is on

/** Radians per look count: 1/4096 rad (~0.014 degrees). */
export const LOOK_UNIT = 1 / 4096;

const INPUT_BYTES = 10;
const PING_BYTES = 12;

const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));

/** lookX / lookY are the running totals in LOOK_UNITs (any integer; sent mod 2^16). */
export function encodeInput({ seq, flags, lookX, lookY, joyX, joyY }) {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, PKT_INPUT);
  v.setUint8(1, flags);
  v.setUint16(2, seq & 0xffff, true);
  v.setUint16(4, Math.round(lookX) & 0xffff, true);
  v.setUint16(6, Math.round(lookY) & 0xffff, true);
  v.setInt8(8, q8(joyX));
  v.setInt8(9, q8(joyY));
  return buf;
}

/** Signed difference of two wrapped 16-bit look totals. */
export const lookDelta = (now, before) => (((now - before) << 16) >> 16);

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
    return {
      type,
      flags: v.getUint8(1),
      seq: v.getUint16(2, true),
      lookX: v.getUint16(4, true),
      lookY: v.getUint16(6, true),
      joyX: v.getInt8(8) / 127,
      joyY: v.getInt8(9) / 127,
    };
  }
  if ((type === PKT_PING || type === PKT_PONG) && v.byteLength >= PING_BYTES) {
    const time = v.getFloat64(4, true);
    if (!Number.isFinite(time)) return null;
    return { type, id: v.getUint16(2, true), time };
  }
  return null;
}

/** True if `seq` is newer than `last`, with 16-bit wrap-around. */
export function seqNewer(seq, last) {
  return ((seq - last) & 0xffff) < 0x8000 && seq !== last;
}

export const ROOM_CODE_RE = /^[A-Z2-9]{4}$/;

// ---- Reliable JSON messages (over the socket "msg" event) ----
//
// phone -> screen
//   {type:"action", name}          lights | view | character | start | again
//   {type:"chat", text}            say something (only lands if someone is near)
//   {type:"rename", name}
// screen -> phone
//   {type:"status", rtt, transport}
//   {type:"state", lampsOn, thirdPerson, party}
//   {type:"you", name, character, accent, color}
//   {type:"game", phase, gold, keys, keysTotal, rank, players, endsIn, objective, result?}
//   {type:"near", names:[...]}     who is inside your chat circle right now
//   {type:"sense", level}          0 (cold) .. 4 (hot): how close the nearest hidden key is
//   {type:"chat", from, text, self}
//   {type:"chat:denied"}

export const MAX_NAME = 16;
export const MAX_CHAT = 100;

/** Trim + strip control characters; keeps emoji and every script. */
export function cleanText(s, max) {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
