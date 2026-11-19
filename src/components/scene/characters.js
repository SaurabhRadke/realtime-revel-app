// Playable characters. Kept free of three.js so the DOM overlay (character
// picker) can import it without pulling in 3D code.
//
// The models are single static meshes (no skeleton). Each one gets a small
// hand-measured "rig" instead: joints read off front/side renders and vertex
// queries of the actual mesh. A vertex shader (Character.jsx) bends the
// limbs around these joints.
//
// All coordinates are in the model's normalised space after `yaw` is applied:
//   x across (-x = the character's RIGHT), y up (0 = feet, 1 = top),
//   z forward (the character faces +z).
//
//   height   metres tall in the world
//   yaw      turn applied to the mesh so its face looks along +z
//   accent   colour of its summoning effect
//   limbs    up to 4 limbs, each a two-bone chain a -> b -> c:
//              kind   "leg" (swings + bends at the knee b), "arm" (swings
//                     opposite the leg on its side), "torch" (raised to hold
//                     the torch out, follows the aim up/down)
//              side   -1 right, +1 left
//              r      radius of the limb (which vertices it moves)
//              clip   only vertices with side * x > clip move (keeps the
//                     torso / the other leg still)
//              foot   legs: footprint half-size [x, z] around c; everything
//                     below the ankle inside it moves as one rigid foot
//   grip     where the torch handle sits in the hand (moves with the
//            "torch" limb if there is one)
//
// Every character already carries a lantern built into its mesh, so the torch
// goes in the other (free) hand.

export const CHARACTERS = [
  {
    id: "plague-doctor",
    name: "Plague Doctor",
    url: "/models/characters/plague-doctor.glb",
    height: 1.8,
    yaw: 0,
    accent: "#7dffb2",
    // Lantern hangs from the raised right arm, staff + crow in the left: the
    // torch goes in the raised right claw. Bird legs under the long robe.
    limbs: [
      // Foot bones run out to the claw tips so each whole foot moves rigidly.
      { kind: "leg", side: -1, a: [-0.08, 0.3, 0.0], b: [-0.11, 0.16, -0.03], c: [-0.12, 0.03, 0.15], r: 0.09, clip: 0.0, foot: [0.1, 0.24] },
      { kind: "leg", side: 1, a: [0.07, 0.3, 0.0], b: [0.08, 0.17, -0.04], c: [0.11, 0.03, 0.12], r: 0.09, clip: 0.0, foot: [0.1, 0.24] },
    ],
    grip: [-0.265, 0.745, 0.19],
  },
  {
    id: "burlap-doll",
    name: "Burlap Doll",
    url: "/models/characters/burlap-doll.glb",
    height: 1.45,
    yaw: 0,
    accent: "#ff8fb1",
    // Lantern in the left hand, satchel on the right; arms are under the
    // cloak, short legs peek out below the hem.
    limbs: [
      { kind: "leg", side: -1, a: [-0.075, 0.12, 0.03], b: [-0.08, 0.06, 0.04], c: [-0.08, 0.0, 0.07], r: 0.055, clip: 0.0 },
      { kind: "leg", side: 1, a: [0.08, 0.12, 0.06], b: [0.085, 0.06, 0.09], c: [0.09, 0.0, 0.16], r: 0.055, clip: 0.0 },
    ],
    grip: [-0.11, 0.31, 0.33],
  },
  {
    id: "pumpkin",
    name: "Pumpkin Head",
    url: "/models/characters/pumpkin.glb",
    height: 1.7,
    yaw: 0,
    accent: "#ffa24a",
    // Lantern raised in the left hand; right arm hangs free -> torch there.
    limbs: [
      { kind: "leg", side: -1, a: [-0.07, 0.27, 0.02], b: [-0.11, 0.15, 0.03], c: [-0.155, 0.02, -0.05], r: 0.075, clip: 0.0, foot: [0.06, 0.11] },
      { kind: "leg", side: 1, a: [0.05, 0.27, 0.05], b: [0.046, 0.15, 0.12], c: [0.046, 0.03, 0.165], r: 0.07, clip: 0.0, foot: [0.06, 0.11] },
      { kind: "torch", side: -1, a: [-0.13, 0.43, 0.02], b: [-0.18, 0.33, 0.02], c: [-0.235, 0.19, 0.03], r: 0.06, clip: 0.12 },
    ],
    grip: [-0.235, 0.21, 0.045],
    raise: 1.05,
  },
  {
    id: "robot",
    name: "Robot",
    url: "/models/characters/robot.glb",
    height: 1.7,
    yaw: Math.PI / 2, // the mesh faces -x
    accent: "#6fe3ff",
    // Both big arms hang free: torch in the right claw, left arm swings.
    limbs: [
      // Chunky limbs: radii cover the whole armour; feet are long flat plates.
      { kind: "leg", side: -1, a: [-0.15, 0.23, 0.03], b: [-0.16, 0.12, 0.05], c: [-0.16, 0.02, 0.105], r: 0.12, clip: 0.0, foot: [0.11, 0.17] },
      { kind: "leg", side: 1, a: [0.12, 0.23, 0.0], b: [0.125, 0.12, 0.02], c: [0.13, 0.02, 0.06], r: 0.12, clip: 0.0, foot: [0.12, 0.18] },
      { kind: "torch", side: -1, a: [-0.31, 0.6, 0.0], b: [-0.3, 0.4, 0.03], c: [-0.28, 0.06, 0.12], r: 0.13, clip: 0.215 },
      { kind: "arm", side: 1, a: [0.29, 0.6, -0.05], b: [0.32, 0.4, 0.0], c: [0.35, 0.1, 0.1], r: 0.13, clip: 0.2 },
    ],
    grip: [-0.285, 0.17, 0.12],
    raise: 0.9,
  },
];

export const DEFAULT_CHARACTER = 0;
