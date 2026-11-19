// Shared, mutable player state: written by the controller (PlayerController)
// every frame, read by the character, torch and camera. Plain objects, no
// React state, so nothing re-renders at 60 fps.

import { Vector3 } from "three";
import { ROAD_HALF_LENGTH } from "./config";

export const player = {
  // Body
  position: new Vector3(0, 0, ROAD_HALF_LENGTH - 2.5), // feet, at the start of the main road
  velocity: new Vector3(),
  speed: 0, // m/s along the ground
  bodyYaw: 0, // which way the character faces (0 = -Z, like the camera)
  turnRate: 0, // rad/s the body is turning (drives the turn-on-the-spot shuffle)
  walkPhase: 0, // step clock: advances by PI per step
  eyeHeight: 1.7, // set from the current character's height

  // View (camera) orientation
  viewYaw: 0,
  pitch: -0.08,

  // First/third person: 0 = FPP, 1 = TPP (eased); see PlayerController
  camBlend: 0,
  wantThirdPerson: false,
  showcase: false, // a character swap/spawn is playing: pull the camera out to watch it
  orbit: 0, // eased 0..1: camera swung round to the character's front for the showcase

  // Where the torch points (world space): where the view looks
  aim: new Vector3(0, 0, ROAD_HALF_LENGTH - 12),

  // Written by the character each frame for the torch
  hand: new Vector3(0, 1, ROAD_HALF_LENGTH - 2.5), // torch grip, world space
  torchScale: 0, // 0..1: torch shrinks away during a character swap
};
