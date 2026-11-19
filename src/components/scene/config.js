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

// ---- Night palette ----
// A clear moonlit night: deep blue-black sky, cool silvery moonlight and a
// dark blue haze that swallows the distance. Street lamps add warm pools of
// light on top (see lampLight.js).
export const PALETTE = {
  skyTop: "#03050b",
  skyHorizon: "#16202f",
  fog: "#111a27",
  moon: "#b9c8e6", // moonlight colour
  hemiSky: "#3a4a6b",
  hemiGround: "#07080b",
  grassTip: "#8a8a6a",
  lamp: "#ffb46a", // warm gas-lamp light
};

// Moon sits ahead of where you start (you face -Z), fairly low, so it is in
// view straight away; it is also the scene's key light.
export const MOON_POSITION = [-38, 46, -110];
export const MOON_INTENSITY = 0.75;
export const HEMI_INTENSITY = 0.55;

// Closer, darker haze than by day: the far side of the town fades to night.
export const FOG_NEAR = 25;
export const FOG_FAR = 170;

// ---- Performance tiers (chosen at runtime by PerformanceMonitor) ----
// Blades are thin 7-vertex strips drawn in a single instanced call.
export const QUALITY_TIERS = [
  { name: "low", blades: 220000, dpr: 1, multisampling: 0 },
  { name: "medium", blades: 420000, dpr: 1.25, multisampling: 2 },
  { name: "high", blades: 650000, dpr: 1.5, multisampling: 4 },
];
export const MAX_BLADES = QUALITY_TIERS[QUALITY_TIERS.length - 1].blades;
