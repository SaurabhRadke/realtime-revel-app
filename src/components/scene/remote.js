// Latest input from each connected phone, written by the host session
// (network) and read every frame by the PlayerController. Plain mutable
// objects, like `input` in controls.js: nothing re-renders at input rate.
// No three.js here, so the network layer can import it cheaply.

/** Input older than this is treated as released (lost phone, dropped link). */
export const REMOTE_STALE_MS = 900;

export function createRemote() {
  return {
    lastPacket: 0, // performance.now() of the last input packet

    // Phone attitude as a unit quaternion [x, y, z, w] in the earth frame
    // (x east, y north, z up). The phone's top edge is the torch direction.
    q: [0, 0, 0, 1],
    hasGyro: false,
    torchFollow: true, // phone-side toggle: aim with the phone or not

    joyX: 0, // -1..1, strafe (right +)
    joyY: 0, // -1..1, walk (forward +)
    run: false,

    // Bumped when the phone asks to recenter, or the phone (re)attaches: the
    // controller then re-takes the phone's current pose as "straight ahead".
    calibration: 0,
  };
}

/** peerId -> remote input state */
export const remotes = new Map();

export function getRemote(peerId) {
  let r = remotes.get(peerId);
  if (!r) {
    r = createRemote();
    remotes.set(peerId, r);
  }
  return r;
}

export function deleteRemote(peerId) {
  remotes.delete(peerId);
}

export function isFresh(r, now = performance.now()) {
  return !!r && now - r.lastPacket < REMOTE_STALE_MS;
}
