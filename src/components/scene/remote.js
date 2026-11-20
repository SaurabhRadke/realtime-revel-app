// Latest input from each connected phone, written by the host session
// (network) and read every frame by the PlayerController. Plain mutable
// objects, like `input` in controls.js: nothing re-renders at input rate.
// No three.js here, so the network layer can import it cheaply.

/** Input older than this is treated as released (lost phone, dropped link). */
export const REMOTE_STALE_MS = 900;

export function createRemote() {
  return {
    lastPacket: 0, // performance.now() of the last input packet

    // Look (the phone's right-half swipe pad). The host turns each packet's
    // running totals into a pending turn; the scene eases it into the view
    // over a few frames, so 30 Hz packets still feel like 60+ fps.
    lookX: 0,
    lookY: 0,
    lookPrimed: false,
    pendingYaw: 0, // radians still to turn right
    pendingPitch: 0, // radians still to look up
    lastLook: -1e9, // performance.now() of the last swipe

    joyX: 0, // -1..1, strafe (right +)
    joyY: 0, // -1..1, walk (forward +)
    run: false,
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
