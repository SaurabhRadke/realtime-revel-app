// Latest input from a connected phone, written by the host session (network)
// and read every frame by the PlayerController. Plain mutable object, like
// `input` in controls.js: nothing re-renders at 60 Hz.

export const remote = {
  connected: false, // a phone is in the room
  lastPacket: 0, // performance.now() of the last input packet

  // Phone attitude as a unit quaternion [x, y, z, w] in the earth frame
  // (x east, y north, z up). The phone's top edge is the torch direction.
  q: [0, 0, 0, 1],
  hasGyro: false,
  torchFollow: true, // phone-side toggle: aim with the phone or not

  joyX: 0, // -1..1, strafe (right +)
  joyY: 0, // -1..1, walk (forward +)
  run: false,

  // Bumped when the phone asks to recenter, or a new phone attaches: the
  // controller then re-takes the phone's current tilt as "level".
  calibration: 0,
};

/** Input older than this is treated as released (lost phone, dropped link). */
export const REMOTE_STALE_MS = 400;

export function resetRemote() {
  remote.connected = false;
  remote.hasGyro = false;
  remote.joyX = 0;
  remote.joyY = 0;
  remote.run = false;
}
