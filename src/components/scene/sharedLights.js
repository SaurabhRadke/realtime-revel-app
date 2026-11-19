// Lights shared by every character, written each frame by the characters /
// torches and applied by <LightPool>. three.js recompiles every lit material
// whenever the NUMBER of lights changes, so the pool always holds the same
// lights (MAX_PLAYERS torch spots, one torch glow, one summon flash); unused
// ones just sit at intensity 0. Players joining and leaving then never stall
// the frame.

import { Color, Vector3 } from "three";
import { MAX_PLAYERS } from "./roster";

export const flashLight = { position: new Vector3(0, -50, 0), intensity: 0, color: new Color() };

// Torch glow: warm spill around the lens of the solo player's torch.
export const glowLight = { position: new Vector3(0, -50, 0), intensity: 0 };

export const torchSpots = Array.from({ length: MAX_PLAYERS }, () => ({
  position: new Vector3(0, -50, 0),
  target: new Vector3(0, -51, 0),
  intensity: 0,
}));
