// Shared scene constants. Grass shader + standard three.js lights read the same
// values so the custom-shaded grass and the Lambert ground stay visually matched.

// ---- World layout (units ~ metres) ----
export const FIELD_RADIUS = 42; // round grass ground
export const GRASS_RADIUS = FIELD_RADIUS - 0.4; // blades stop just inside the wall

// ---- Old stone roads: a main street along Z and one cross street along X ----
// No kerbs: flat stones and broken bricks bedded in mud, with a ragged muddy
// verge on each side that fades unevenly into the grass.
export const ROAD_WIDTH = 6; // stone surface (edges are ragged, so it varies)
export const MUD_VERGE = 1.2; // trodden mud beyond the stones, each side
const ROAD_OUTER = ROAD_WIDTH / 2 + MUD_VERGE;
// Length from the centre to where the road meets the boundary wall.
export const ROAD_HALF_LENGTH = Math.sqrt(FIELD_RADIUS ** 2 - ROAD_OUTER ** 2) - 0.1;

// True if (x, z) is on the road. Grass is allowed over the outer half of the
// mud verge so the road edge blends into the turf instead of a straight line.
export function isOnRoad(x, z) {
  const half = ROAD_WIDTH / 2 + MUD_VERGE * 0.45;
  return Math.abs(x) < half || Math.abs(z) < half;
}

// ---- Walker (first-person) ----
export const EYE_HEIGHT = 1.7;
export const WALK_SPEED = 4.5; // m/s
export const START_POSITION = [0, EYE_HEIGHT, ROAD_HALF_LENGTH - 2.5]; // start of the main road

// ---- Vintage golden-hour palette ----
export const PALETTE = {
  skyTop: "#6a8796",
  skyHorizon: "#e9c99a",
  fog: "#d9bf94",
  sun: "#ffd29a",
  hemiSky: "#f3dcb4",
  hemiGround: "#4a4426",
  grassTip: "#c8b46a", // dry, straw-coloured tips
};

// Low sun, slightly behind and to the side -> long warm light, backlit blades.
export const SUN_POSITION = [-60, 34, -45];
export const SUN_INTENSITY = 3.6;
export const HEMI_INTENSITY = 2.1;

export const FOG_NEAR = 80;
export const FOG_FAR = 340;

// ---- Performance tiers (chosen at runtime by PerformanceMonitor) ----
// Blades are thin 7-vertex strips drawn in a single instanced call.
export const QUALITY_TIERS = [
  { name: "low", blades: 220000, dpr: 1, multisampling: 0 },
  { name: "medium", blades: 420000, dpr: 1.25, multisampling: 2 },
  { name: "high", blades: 650000, dpr: 1.5, multisampling: 4 },
];
export const MAX_BLADES = QUALITY_TIERS[QUALITY_TIERS.length - 1].blades;
