// Fixed set pieces of the town: the three townsfolk you can talk to and the
// props around them. Plain numbers, no three.js: the random town layout
// (townLayout.js) reads these to keep houses and street lamps off them, the
// walker collides with them, and the item scatter avoids them.
//
//   Crossroads   Old Wick the lamplighter (quest giver), the well, a bench,
//                a signpost pointing to the others
//   West road    Madame Hollow's striped tent, her cauldron
//   East road    Ember the fox's market cart, barrels and crates
//   South road   (where everyone spawns) two banners mark the town gate
//   North road   two more banners
//
// All models face +z in their own space, so `yaw` turns that towards a target.

import PROP_MODELS from "./propModels.json";

const MODEL = Object.fromEntries(PROP_MODELS.map((m) => [m.id, m]));

const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

/** Scale that makes `model` `size` metres along `by` ("height" | "width"). */
function scaleFor(model, size, by = "height") {
  const m = MODEL[model];
  return m ? size / m[by] : 1;
}

function prop(id, model, x, z, { size, by = "height", yaw = 0, radius, solid = true }) {
  const m = MODEL[model];
  const scale = scaleFor(model, size, by);
  const footprint = m ? (Math.max(m.width, m.depth) * scale) / 2 : 0.5;
  return { id, model, url: m?.url, x, z, yaw, scale, radius: radius ?? footprint * 0.8, solid };
}

// ---- Townsfolk ----
// `stand`: where they stand; `talk`: how close you must be to talk.
export const NPC_SPOTS = {
  wick: { x: -5.3, z: 5.3, yaw: faceTo(-5.3, 5.3, 0, 12), model: "lamplighter", size: 2.05 },
  hollow: { x: -33.4, z: 1.3, yaw: faceTo(-33.4, 1.3, -20, 1.3), model: "fortune-teller", size: 2.15 },
  ember: { x: 33.6, z: 1.5, yaw: faceTo(33.6, 1.5, 20, 1.5), model: "cat", size: 1.75 },
};

export const NPC_RADIUS = 0.55; // body, for walking collision
export const TALK_RADIUS = 3.4;
export const TALK_RELEASE = 4.6; // a conversation ends when you walk this far off

// ---- Props ----
export const PROPS = [
  // Crossroads
  prop("well", "well", 5.55, 5.55, { size: 2.7, yaw: faceTo(5.55, 5.55, 0, 0), radius: 1.15 }),
  prop("bench", "bench", -5.5, -5.6, { size: 2.1, by: "width", yaw: faceTo(-5.5, -5.6, 0, 0), radius: 0.9 }),
  // West road: the seer's tent sits across the road's far end.
  prop("tent", "tent", -37.2, 0, { size: 4.4, yaw: Math.PI / 2, radius: 2.2 }),
  prop("cauldron", "campfire", -33.6, -1.5, { size: 1.05, yaw: Math.PI / 2, radius: 0.55 }),
  prop("barrels-w", "barrels", -36.2, 3.2, { size: 1.25, radius: 0.5 }),
  // East road: the merchant's cart.
  prop("cart", "cart", 36.6, -0.2, { size: 2.7, yaw: -Math.PI / 2, radius: 1.5 }),
  prop("barrels-e", "barrels", 37.4, 2.6, { size: 1.3, radius: 0.5 }),
  prop("barrels-e2", "barrels", 35.4, 3.1, { size: 1.05, yaw: 1.2, radius: 0.45 }),
  // Banners: the town gate (south, where everyone arrives) and the north end.
  prop("banner-sw", "flag", -4.1, 35.2, { size: 3.6, yaw: 0, radius: 0.3 }),
  prop("banner-se", "flag", 4.1, 35.2, { size: 3.6, yaw: 0, radius: 0.3 }),
  prop("banner-nw", "flag", -4.1, -36, { size: 3.6, yaw: Math.PI, radius: 0.3 }),
  prop("banner-ne", "flag", 4.1, -36, { size: 3.6, yaw: Math.PI, radius: 0.3 }),
];

// Generated (no model file): crates by the cart and the crossroads signpost.
export const CRATES = [
  { x: 35.0, z: -2.5, size: 0.85, yaw: 0.3 },
  { x: 35.9, z: -3.0, size: 0.7, yaw: -0.2 },
  { x: 35.35, z: -2.75, size: 0.55, yaw: 0.8, stackOn: 0 },
];
export const SIGNPOST = { x: 4.9, z: -4.9, radius: 0.25 };

/** Every solid circle (props, townsfolk, signpost, crates) for collision + layout. */
export const BLOCKERS = [
  ...PROPS.filter((p) => p.solid).map((p) => ({ x: p.x, z: p.z, r: p.radius })),
  ...Object.values(NPC_SPOTS).map((n) => ({ x: n.x, z: n.z, r: NPC_RADIUS })),
  ...CRATES.filter((c) => c.stackOn == null).map((c) => ({ x: c.x, z: c.z, r: c.size * 0.62 })),
  { x: SIGNPOST.x, z: SIGNPOST.z, r: SIGNPOST.radius },
];

/** True if (x, z) is within `margin` of any prop or townsfolk. */
export function isNearProp(x, z, margin = 0) {
  for (const b of BLOCKERS) if (Math.hypot(x - b.x, z - b.z) < b.r + margin) return true;
  return false;
}

/** Named places, for directions ("near the well"). */
export const LANDMARKS = [
  { name: "the crossroads", x: 0, z: 0 },
  { name: "the old well", x: 5.55, z: 5.55 },
  { name: "Madame Hollow's tent", x: -37.2, z: 0 },
  { name: "Ember's cart", x: 36.6, z: 0 },
  { name: "the town gate", x: 0, z: 35 },
  { name: "the north banners", x: 0, z: -36 },
];

/** Where in town a point is, in words. */
export function describePlace(x, z) {
  let best = LANDMARKS[0];
  let bestD = Infinity;
  for (const l of LANDMARKS) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return { landmark: best.name, distance: bestD };
}

/** Compass word for a direction (north = -z, the way you face at the start). */
export function compassWord(dx, dz) {
  const words = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const a = Math.atan2(dx, -dz); // 0 = north, clockwise
  const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return words[i];
}
