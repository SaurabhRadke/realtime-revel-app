// A small random township, re-rolled on every page load.
//
// Houses line both sides of both roads (8 road sides in all). Walking out from
// the crossroads along each side, houses are dropped one after another with a
// random model (repeats allowed), size, setback and gap, turned to face the
// road, each with a winding mud path from its front door to the road. Any
// house or path that would overlap another, or poke through the boundary
// wall, is skipped. Victorian street lamps then line the road verges, leaving
// the path mouths clear.
//
// The layout is made once per page load (module level), so the grass, paths,
// houses, lamps and walking collision all agree on it; reloading the page
// builds a different town.

import { CatmullRomCurve3, Vector3 } from "three";
import { FIELD_RADIUS, MUD_VERGE, ROAD_WIDTH, isOnRoad } from "./config";
import SCENE_MODELS from "./sceneModels.json";
import { BLOCKERS } from "./townProps";

const HOUSE_MODELS = SCENE_MODELS.filter((m) => m.kind === "house");
const LAMP_MODEL = SCENE_MODELS.find((m) => m.kind === "lamp");

const ROAD_OUTER = ROAD_WIDTH / 2 + MUD_VERGE;
const WALL_MARGIN = 2; // keep house corners this far inside the boundary wall

// ---- Houses ----
const FOOTPRINT = [6.5, 9.5]; // longest side of a house on the ground, metres
const MAX_HEIGHT = 9; // tall, narrow models are scaled down to this
const SETBACK = [2.5, 8]; // grass between the road's mud verge and the house front
const GAP = [2.5, 6]; // between neighbouring houses along the road
const HOUSE_CLEARANCE = 1.2; // minimum space between any two houses
const PATH_WIDTH = [1.5, 2.1];

// ---- Street lamps ----
const LAMP_HEIGHT = 4.2;
const LAMP_SPACING = 11; // along each side; the two sides are staggered
const LAMP_OFFSET = ROAD_WIDTH / 2 + 0.55; // from the road centre line, on the verge
const LAMP_RADIUS = 0.3; // for walking collision

const rand = (a, b) => a + Math.random() * (b - a);

// Deals models from a shuffled bag, refilled when empty: repeats happen, but
// every model gets used before any one is used again.
let bag = [];
function nextHouseModel() {
  if (!bag.length) bag = [...HOUSE_MODELS].sort(() => Math.random() - 0.5);
  return bag.pop();
}

// Rotate (x, z) by yaw (three.js Y rotation convention).
function rotateY(x, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

// World point -> house-local (x along the front, z towards the road).
function toLocal(house, x, z) {
  return rotateY(x - house.x, z - house.z, -house.yaw);
}

function corners(h, grow = 0) {
  const hx = h.halfWidth + grow;
  const hz = h.halfDepth + grow;
  return [
    [hx, hz],
    [-hx, hz],
    [hx, -hz],
    [-hx, -hz],
  ].map(([cx, cz]) => {
    const [wx, wz] = rotateY(cx, cz, h.yaw);
    return [h.x + wx, h.z + wz];
  });
}

// Separating-axis test for two rotated footprint rectangles.
function housesOverlap(a, b, clearance) {
  const ca = corners(a, clearance / 2);
  const cb = corners(b, clearance / 2);
  for (const yaw of [a.yaw, b.yaw]) {
    for (const [ax, az] of [rotateY(1, 0, yaw), rotateY(0, 1, yaw)]) {
      const proj = (pts) => pts.map(([x, z]) => x * ax + z * az);
      const pa = proj(ca);
      const pb = proj(cb);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

function insideHouse(house, x, z, margin) {
  const [lx, lz] = toLocal(house, x, z);
  return Math.abs(lx) < house.halfWidth + margin && Math.abs(lz) < house.halfDepth + margin;
}

/**
 * Winding path from the front door to the road. Points are in world XZ; the
 * last one sits on the road's mud verge so the path merges into it.
 */
function makePath(house) {
  const { x, z, yaw, halfDepth, road, side, half } = house;
  const [fx, fz] = rotateY(0, 1, yaw); // front direction
  const door = [x + fx * (halfDepth - 0.3), z + fz * (halfDepth - 0.3)];
  const step = [door[0] + fx * 1.4, door[1] + fz * 1.4];

  // Where the path meets the road: across from the door, drifted a little.
  const edge = ROAD_WIDTH / 2 + 0.3;
  const doorAlong = road === "main" ? step[1] : step[0];
  const along = half * Math.max(ROAD_OUTER + 2, Math.abs(doorAlong + rand(-1.5, 1.5)));
  const end = road === "main" ? [side * edge, along] : [along, side * edge];

  const pts = [door, step];
  const dx = end[0] - step[0];
  const dz = end[1] - step[1];
  const len = Math.hypot(dx, dz);
  if (len > 3) {
    // A lazy bend or two on longer paths.
    const nx = -dz / len;
    const nz = dx / len;
    const bends = len > 6 && Math.random() < 0.5 ? 2 : 1;
    for (let i = 1; i <= bends; i++) {
      const t = i / (bends + 1);
      const wobble = rand(-1, 1) * Math.min(1.2, len * 0.15);
      pts.push([step[0] + dx * t + nx * wobble, step[1] + dz * t + nz * wobble]);
    }
  }
  pts.push(end);

  const curve = new CatmullRomCurve3(
    pts.map(([px, pz]) => new Vector3(px, 0, pz)),
    false,
    "centripetal",
  );
  const samples = Math.max(8, Math.ceil(curve.getLength() * 2));
  const points = curve.getSpacedPoints(samples).map((v) => [v.x, v.z]);
  const width = rand(...PATH_WIDTH);
  return {
    points,
    width,
    seed: 1 + Math.floor(Math.random() * 1000), // for its ragged edge mask
    bounds: boundsOf(points, width),
  };
}

function boundsOf(points, pad) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return [x0 - pad, x1 + pad, z0 - pad, z1 + pad];
}

function pathHitsHouse(path, house) {
  const margin = path.width / 2 + 0.3;
  return path.points.some(([x, z]) => insideHouse(house, x, z, margin));
}

function fits(candidate, houses) {
  if (corners(candidate, 0.4).some(([x, z]) => Math.hypot(x, z) > FIELD_RADIUS - WALL_MARGIN)) return false;
  // Keep clear of the fixed set pieces (townsfolk, well, tent, cart...).
  for (const b of BLOCKERS) {
    if (insideHouse(candidate, b.x, b.z, b.r + 0.8)) return false;
    if (candidate.path.points.some(([x, z]) => Math.hypot(x - b.x, z - b.z) < b.r + 0.6)) return false;
  }
  for (const h of houses) {
    if (housesOverlap(candidate, h, HOUSE_CLEARANCE)) return false;
    if (pathHitsHouse(h.path, candidate) || pathHitsHouse(candidate.path, h)) return false;
  }
  return true;
}

/** Fill one side of one half of a road with a row of houses. */
function fillRoadSide(road, side, half, houses) {
  // Main road runs along Z (x = 0); cross road along X (z = 0).
  // `side` picks which side of the road, `half` which way from the crossroads.
  let cursor = ROAD_OUTER + rand(0.5, 3);
  while (cursor < FIELD_RADIUS - 5) {
    const model = nextHouseModel();
    const footprint = rand(...FOOTPRINT);
    const scale = Math.min(footprint / Math.max(model.width, model.depth), MAX_HEIGHT / model.height);
    const halfWidth = (model.width * scale) / 2;
    const halfDepth = (model.depth * scale) / 2;

    const away = ROAD_OUTER + rand(...SETBACK) + halfDepth; // centre's distance from the road
    const along = half * (cursor + halfWidth);
    const x = road === "main" ? side * away : along;
    const z = road === "main" ? along : side * away;
    // Front (+Z local) points back at the road, not quite square to it.
    const face = road === "main" ? -side * (Math.PI / 2) : side > 0 ? Math.PI : 0;
    const yaw = face + rand(-0.08, 0.08);

    const house = { url: model.url, scale, x, z, yaw, halfWidth, halfDepth, road, side, half };
    house.path = makePath(house);
    if (fits(house, houses)) {
      houses.push(house);
      cursor += halfWidth * 2 + rand(...GAP);
    } else {
      bag.push(model); // put it back for the next spot
      cursor += 1.5; // shuffle along and try again
    }
  }
}

function placeLamps(houses) {
  const lamps = [];
  const pathMouths = houses.map((h) => h.path.points.at(-1));
  const scale = LAMP_HEIGHT / LAMP_MODEL.height;
  for (const road of ["main", "cross"]) {
    for (const side of [-1, 1]) {
      for (const half of [-1, 1]) {
        const stagger = side > 0 ? 0 : LAMP_SPACING / 2;
        for (let a = ROAD_OUTER + 2 + stagger; a < FIELD_RADIUS - 3; a += LAMP_SPACING) {
          const along = half * (a + rand(-0.6, 0.6));
          const x = road === "main" ? side * LAMP_OFFSET : along;
          const z = road === "main" ? along : side * LAMP_OFFSET;
          if (Math.hypot(x, z) > FIELD_RADIUS - 1.5) continue;
          // Keep path mouths and the set pieces clear.
          if (pathMouths.some(([px, pz]) => Math.hypot(px - x, pz - z) < 2.2)) continue;
          if (BLOCKERS.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 1.1)) continue;
          // Arms run along the road.
          const yaw = (road === "main" ? Math.PI / 2 : 0) + (Math.random() < 0.5 ? 0 : Math.PI);
          lamps.push({ x, z, yaw, scale, height: LAMP_HEIGHT });
        }
      }
    }
  }
  return lamps;
}

function createLayout() {
  const houses = [];
  // Random order so no side always gets first pick near the crossroads.
  const sides = [];
  for (const road of ["main", "cross"]) {
    for (const side of [-1, 1]) for (const half of [-1, 1]) sides.push([road, side, half]);
  }
  sides.sort(() => Math.random() - 0.5);
  for (const [road, side, half] of sides) fillRoadSide(road, side, half, houses);

  const lamps = LAMP_MODEL ? placeLamps(houses) : [];
  return { houses, lamps, grid: buildGrid(houses) };
}

let layout = null;
export function getTownLayout() {
  if (!layout) layout = createLayout();
  return layout;
}

/** Every model URL the town uses (each once), for preloading. */
export function getTownModelUrls() {
  const { houses, lamps } = getTownLayout();
  const urls = new Set(houses.map((h) => h.url));
  if (lamps.length) urls.add(LAMP_MODEL.url);
  return [...urls];
}

export const LAMP_URL = LAMP_MODEL?.url;

// ---- Spatial grid: which houses/paths can touch each 4 m cell ----
// The grass asks "is this spot free?" for hundreds of thousands of blades, so
// each blade only tests the few houses near it.

const CELL = 4;
const GRID_N = Math.ceil((FIELD_RADIUS * 2) / CELL);
const cellIndex = (v) => Math.min(GRID_N - 1, Math.max(0, Math.floor((v + FIELD_RADIUS) / CELL)));

function buildGrid(houses) {
  const grid = Array.from({ length: GRID_N * GRID_N }, () => []);
  for (const h of houses) {
    const pts = corners(h);
    const [hx0, hx1, hz0, hz1] = boundsOf(pts, 0);
    const [px0, px1, pz0, pz1] = h.path.bounds;
    const x0 = Math.min(hx0, px0);
    const x1 = Math.max(hx1, px1);
    const z0 = Math.min(hz0, pz0);
    const z1 = Math.max(hz1, pz1);
    for (let i = cellIndex(x0); i <= cellIndex(x1); i++) {
      for (let j = cellIndex(z0); j <= cellIndex(z1); j++) grid[j * GRID_N + i].push(h);
    }
  }
  return grid;
}

// ---- Queries used by the grass and the walker ----

function distToSegmentSq(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const ex = ax + dx * t - px;
  const ez = az + dz * t - pz;
  return ex * ex + ez * ez;
}

function onPath(path, x, z) {
  const [x0, x1, z0, z1] = path.bounds;
  if (x < x0 || x > x1 || z < z0 || z > z1) return false;
  // Grass may grow over the outer edge, like along the roads.
  const r = path.width * 0.4;
  const r2 = r * r;
  const pts = path.points;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegmentSq(x, z, pts[i - 1], pts[i]) < r2) return true;
  }
  return false;
}

/** True where no grass should grow: roads, house footprints and their paths. */
export function isBlocked(x, z) {
  if (isOnRoad(x, z)) return true;
  const { grid } = getTownLayout();
  for (const h of grid[cellIndex(z) * GRID_N + cellIndex(x)]) {
    if (insideHouse(h, x, z, -0.3) || onPath(h.path, x, z)) return true;
  }
  return false;
}

/**
 * Pushes a walker at `pos` (Vector3, XZ used) out of houses (their footprint
 * rectangles), the set pieces (townProps.js) and lamp posts, keeping `radius`
 * of body clearance.
 */
export function collideWithTown(pos, radius) {
  const { houses, lamps } = getTownLayout();
  for (const h of houses) {
    const hx = h.halfWidth * 0.92 + radius;
    const hz = h.halfDepth * 0.92 + radius;
    const [lx, lz] = toLocal(h, pos.x, pos.z);
    if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) continue;
    // Out through the nearest side.
    let nx = lx;
    let nz = lz;
    if (hx - Math.abs(lx) < hz - Math.abs(lz)) nx = Math.sign(lx || 1) * hx;
    else nz = Math.sign(lz || 1) * hz;
    const [wx, wz] = rotateY(nx, nz, h.yaw);
    pos.x = h.x + wx;
    pos.z = h.z + wz;
  }
  for (const b of BLOCKERS) {
    const dx = pos.x - b.x;
    const dz = pos.z - b.z;
    const d = Math.hypot(dx, dz);
    const m = b.r + radius;
    if (d < m) {
      if (d > 1e-4) {
        pos.x = b.x + (dx / d) * m;
        pos.z = b.z + (dz / d) * m;
      } else {
        pos.x = b.x + m;
      }
    }
  }
  const min = LAMP_RADIUS + radius;
  for (const l of lamps) {
    const dx = pos.x - l.x;
    const dz = pos.z - l.z;
    const d = Math.hypot(dx, dz);
    if (d < min) {
      const k = d > 1e-4 ? min / d : 0;
      pos.x = l.x + (d > 1e-4 ? dx * k : min);
      pos.z = l.z + dz * k;
    }
  }
}

/** True if (x, z) is inside any house footprint grown by `margin`. */
export function isInsideHouse(x, z, margin = 0) {
  const { grid } = getTownLayout();
  for (const h of grid[cellIndex(z) * GRID_N + cellIndex(x)]) {
    if (insideHouse(h, x, z, margin)) return true;
  }
  return false;
}
