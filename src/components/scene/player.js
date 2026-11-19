// Per-character mutable state: written by the controller (PlayerController)
// every frame, read by that character's body, torch and name tag, and by the
// camera. Plain objects, no React state, so nothing re-renders at 60 fps.
// One per roster entry (roster.js), looked up by its id.

import { Vector3 } from "three";
import { ROAD_HALF_LENGTH } from "./config";

// Where each slot appears: side by side at the start of the main road.
const SPAWN_SPREAD = 1.6;
export function spawnPoint(slot, out = new Vector3()) {
  const offset = (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * SPAWN_SPREAD;
  return out.set(offset, 0, ROAD_HALF_LENGTH - 2.5 - (slot ? 1 : 0));
}

export function createPlayerState(slot = 0) {
  const position = spawnPoint(slot);
  return {
    // Body
    position, // feet
    velocity: new Vector3(),
    speed: 0, // m/s along the ground
    bodyYaw: 0, // which way the character faces (0 = -Z, like the camera)
    turnRate: 0, // rad/s the body is turning (drives the turn-on-the-spot shuffle)
    walkPhase: 0, // step clock: advances by PI per step
    eyeHeight: 1.7, // set from the current character's height
    height: 1.7, // character height, for the name tag

    // View / aim orientation. Solo: the camera's. Party: the torch's.
    viewYaw: 0,
    pitch: -0.08,

    // First/third person: 0 = FPP, 1 = TPP (eased); see PlayerController
    camBlend: 0,
    wantThirdPerson: false,
    showcase: false, // a character swap/spawn is playing: pull the camera out to watch it
    orbit: 0, // eased 0..1: camera swung round to the character's front for the showcase
    firstPerson: true, // the camera is in this character's eyes: hide the body

    // Where the torch points (world space)
    aim: new Vector3(position.x, 0, position.z - 10),

    // Written by the character each frame for the torch
    hand: new Vector3(position.x, 1, position.z), // torch grip, world space
    torchScale: 0, // 0..1: torch shrinks away during a character swap
    // Written by the torch: the beam, for revealing hidden keys
    lens: new Vector3(position.x, 1, position.z),
    beamDir: new Vector3(0, 0, -1),
    torchOn: 0,

    // Phone gyro bookkeeping (PlayerController)
    phone: { calibration: -1, lastHeading: null, pitchZero: 0, primed: false, q: null, target: null },
  };
}

/** roster id -> state */
export const playerStates = new Map();

export function getPlayerState(id, slot = 0) {
  let p = playerStates.get(id);
  if (!p) {
    p = createPlayerState(slot);
    playerStates.set(id, p);
  }
  return p;
}

export function dropPlayerState(id) {
  playerStates.delete(id);
}
