import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from "three";
import { mulberry32, tilingNoiseField, valueNoise } from "./utils";

// Metres of road one texture tile covers.
export const STONE_TILE_METRES = 4;
export const MUD_TILE_METRES = 3;

// Field / river stones: creams, greys and in-between weathered tones.
const CREAM_STONES = [
  [214, 200, 168],
  [202, 189, 158],
  [226, 214, 186],
  [196, 180, 146],
];
const GREY_STONES = [
  [150, 148, 142],
  [128, 126, 120],
  [170, 166, 158],
  [112, 110, 106],
];
const MIXED_STONES = [
  [146, 136, 118],
  [160, 150, 128],
  [124, 116, 102],
];
const BRICK_COLORS = [
  [138, 74, 52],
  [125, 70, 50],
  [150, 88, 62],
];
const MUD = [92, 74, 50];

const SHAPE_ROUND = 0; // smooth, domed cobble
const SHAPE_IRREGULAR = 1; // lumpy, flatter slab
const SHAPE_BRICK = 2; // old rounded-off brick fragment

function toTexture(canvas, srgb, repeat) {
  const t = new CanvasTexture(canvas);
  if (srgb) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 16;
  return t;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

/**
 * Old road surface: rounded stones sunk ~75% into mud, so only their worn tops
 * show. Mixed cream / grey / weathered tones, lumpy irregular outlines, a few
 * brick fragments, and stones missing singly and in small groups. Returns
 * colour + bump maps that tile seamlessly.
 */
export function createStoneTextures(size = 1024) {
  const GRID = 14; // ~29 cm spacing on a 4 m tile
  const cellPx = size / GRID;
  const rand = mulberry32(1871);

  // One stone per grid cell (jittered), with its own shape, size and colour.
  const N = GRID * GRID;
  const stones = new Array(N);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const r = rand();
      const shape = r < 0.06 ? SHAPE_BRICK : r < 0.38 ? SHAPE_IRREGULAR : SHAPE_ROUND;
      const c = rand();
      const palette =
        shape === SHAPE_BRICK ? BRICK_COLORS : c < 0.38 ? CREAM_STONES : c < 0.78 ? GREY_STONES : MIXED_STONES;
      const tone = 0.88 + rand() * 0.24;
      const angle = rand() * Math.PI;
      const ph2 = rand() * Math.PI * 2;
      const ph3 = rand() * Math.PI * 2;
      // Only the exposed cap shows (the rest is under the mud), so the visible
      // outline is smaller than the stone and leaves plenty of mud around it.
      const size0 = cellPx * (0.26 + rand() * 0.16);
      const aspect = 0.65 + rand() * 0.35;
      stones[j * GRID + i] = {
        missing: rand() < 0.1,
        shape,
        x: (i + 0.25 + rand() * 0.5) * cellPx,
        y: (j + 0.25 + rand() * 0.5) * cellPx,
        rx: shape === SHAPE_BRICK ? size0 * 1.1 : size0,
        ry: shape === SHAPE_BRICK ? size0 * 0.5 : size0 * aspect,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        // Outline wobble (2nd and 3rd harmonics): lumpier for irregular stones.
        a2: shape === SHAPE_IRREGULAR ? 0.1 + rand() * 0.1 : rand() * 0.06,
        a3: shape === SHAPE_IRREGULAR ? 0.06 + rand() * 0.08 : rand() * 0.04,
        c2: Math.cos(ph2),
        s2: Math.sin(ph2),
        c3: Math.cos(ph3),
        s3: Math.sin(ph3),
        color: palette[Math.floor(rand() * palette.length)].map((v) => v * tone),
        height: 0.6 + rand() * 0.4,
      };
    }
  }
  const reach = cellPx * 0.5; // quick reject radius (largest stone + wobble)

  const groupNoise = tilingNoiseField(3, 21); // small groups of missing stones
  const dirtNoise = tilingNoiseField(16, 3);
  const wetNoise = tilingNoiseField(10, 4);

  const color = document.createElement("canvas");
  const bump = document.createElement("canvas");
  color.width = color.height = bump.width = bump.height = size;
  const cctx = color.getContext("2d");
  const bctx = bump.getContext("2d");
  const cImg = cctx.createImageData(size, size);
  const bImg = bctx.createImageData(size, size);
  const cd = cImg.data;
  const bd = bImg.data;

  for (let y = 0; y < size; y++) {
    const iy = Math.floor(y / cellPx);
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const ix = Math.floor(x / cellPx);
      const u = x / size;

      // Highest stone cap covering this pixel among the 3x3 neighbouring cells.
      let bestH = 0;
      let best = null;
      let bestCap = 0;
      let bestLx = 0;
      let bestLy = 0;
      let qMin = 9; // for the damp ring of mud hugging each stone
      for (let oy = -1; oy <= 1; oy++) {
        const cy = iy + oy;
        const wy = (cy + GRID) % GRID;
        for (let ox = -1; ox <= 1; ox++) {
          const cx = ix + ox;
          const wx = (cx + GRID) % GRID;
          const s = stones[wy * GRID + wx];
          if (s.missing) continue;
          const dx = x - (s.x + (cx - wx) * cellPx);
          const dy = y - (s.y + (cy - wy) * cellPx);
          if (dx * dx + dy * dy > reach * reach) continue;

          // Into the stone's own rotated, stretched frame.
          const lx = (dx * s.cos + dy * s.sin) / s.rx;
          const ly = (-dx * s.sin + dy * s.cos) / s.ry;
          let q;
          if (s.shape === SHAPE_BRICK) {
            // Rounded rectangle (superellipse): a worn brick end.
            q = Math.sqrt(Math.sqrt(lx ** 4 + ly ** 4));
          } else {
            const len = Math.sqrt(lx * lx + ly * ly) || 1e-6;
            const c1 = lx / len;
            const s1 = ly / len;
            const cos2 = c1 * c1 - s1 * s1;
            const sin2 = 2 * c1 * s1;
            const cos3 = c1 * (4 * c1 * c1 - 3);
            const sin3 = s1 * (3 - 4 * s1 * s1);
            const wobble = 1 + s.a2 * (cos2 * s.c2 + sin2 * s.s2) + s.a3 * (cos3 * s.c3 + sin3 * s.s3);
            q = len / wobble;
          }
          if (q < qMin) qMin = q;
          if (q < 1) {
            const dome = Math.sqrt(1 - q * q); // rounded cap
            const h = s.shape === SHAPE_ROUND ? dome : Math.pow(dome, 0.45); // slabs are flatter
            if (h * s.height > bestH) {
              bestH = h * s.height;
              best = s;
              bestCap = h;
              bestLx = lx;
              bestLy = ly;
            }
          }
        }
      }

      const grain = rand();
      const p = (y * size + x) * 4;
      let r;
      let g;
      let b;
      let h;

      if (best && groupNoise(u, v) < 0.66) {
        const s = best;
        const cap = bestCap;
        // Soft top-lit shading of the dome + darker where it dives into mud.
        const light = 0.62 + 0.38 * cap - 0.08 * (bestLx + bestLy) * (1 - cap);
        const shade = light * (0.93 + grain * 0.14);
        // Mud clings to the low sides of every stone; a light dirt film on top.
        const mudCling = Math.pow(1 - cap, 2.2) * 0.75 + dirtNoise(u, v) * 0.18;
        r = mix(s.color[0] * shade, MUD[0] * 0.8, mudCling);
        g = mix(s.color[1] * shade, MUD[1] * 0.8, mudCling);
        b = mix(s.color[2] * shade, MUD[2] * 0.8, mudCling);
        h = 110 + 145 * cap * s.height;
      } else {
        const wet = wetNoise(u, v);
        let sMud = (0.72 + wet * 0.42) * (0.86 + grain * 0.28);
        // Damp, darker ring where the mud meets a stone.
        if (qMin < 1.3) sMud *= 0.78 + 0.22 * Math.min(1, Math.max(0, (qMin - 1) / 0.3));
        if (grain > 0.993) {
          r = 150;
          g = 140;
          b = 120;
          h = 85; // grit / pebble
        } else {
          r = MUD[0] * sMud;
          g = MUD[1] * sMud;
          b = MUD[2] * sMud;
          h = 35 + wet * 30 + grain * 18;
        }
      }

      cd[p] = r;
      cd[p + 1] = g;
      cd[p + 2] = b;
      cd[p + 3] = 255;
      bd[p] = bd[p + 1] = bd[p + 2] = h;
      bd[p + 3] = 255;
    }
  }

  cctx.putImageData(cImg, 0, 0);
  bctx.putImageData(bImg, 0, 0);
  return { map: toTexture(color, true, true), bumpMap: toTexture(bump, false, true) };
}

/**
 * Trodden mud for the verges and the bare patches: uneven wet/dry earth,
 * pebbles and a few stray green specks. Tiles seamlessly.
 */
export function createMudTextures(size = 512) {
  const rand = mulberry32(77);
  const wet = tilingNoiseField(9, 11);
  const ruts = tilingNoiseField(4, 12);

  const color = document.createElement("canvas");
  const bump = document.createElement("canvas");
  color.width = color.height = bump.width = bump.height = size;
  const cctx = color.getContext("2d");
  const bctx = bump.getContext("2d");
  const cImg = cctx.createImageData(size, size);
  const bImg = bctx.createImageData(size, size);
  const cd = cImg.data;
  const bd = bImg.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const w = wet(u, v);
      const rt = ruts(u, v);
      const grain = rand();
      let s = (0.7 + w * 0.45 + rt * 0.15) * (0.86 + grain * 0.28);
      let r = MUD[0] * s;
      let g = MUD[1] * s;
      let b = MUD[2] * s;
      let h = 60 + rt * 80 + grain * 30;
      if (grain > 0.993) {
        r = 148;
        g = 138;
        b = 118;
        h = 200;
      } else if (grain < 0.004) {
        s = 0.8 + rand() * 0.4;
        r = 84 * s;
        g = 98 * s;
        b = 46 * s;
      }
      const p = (y * size + x) * 4;
      cd[p] = r;
      cd[p + 1] = g;
      cd[p + 2] = b;
      cd[p + 3] = 255;
      bd[p] = bd[p + 1] = bd[p + 2] = h;
      bd[p + 3] = 255;
    }
  }

  cctx.putImageData(cImg, 0, 0);
  bctx.putImageData(bImg, 0, 0);
  return { map: toTexture(color, true, true), bumpMap: toTexture(bump, false, true) };
}

/**
 * Alpha mask stretched over a whole street (not tiled, so nothing repeats):
 * opaque in the middle, a ragged wandering edge with bites near the sides and,
 * optionally, `holes`: scattered groups of bare patches where the stones are
 * gone and the mud layer underneath shows through.
 */
export function createEdgeMask({ seed, ragged, bites, holes = 0, length = 2048, width = 128 }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = length;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, length);
  const d = img.data;

  for (let y = 0; y < length; y++) {
    const v = y / length;
    // Two wandering edges, each with its own large and fine wobble.
    const wobbleL =
      valueNoise(v * 30 + seed, seed * 3.1) * 0.65 + valueNoise(v * 140 + seed * 2, seed * 5.7) * 0.35;
    const wobbleR =
      valueNoise(v * 30 - seed, seed * 7.3) * 0.65 + valueNoise(v * 140 - seed * 2, seed * 1.9) * 0.35;
    // Clusters: some stretches of road have several bare patches, others none.
    const cluster = holes ? valueNoise(v * 9 + seed * 4.3, seed * 2.2) : 0;
    for (let x = 0; x < width; x++) {
      const t = ((x + 0.5) / width) * 2 - 1; // -1 .. 1 across the street
      const limit = 1 - (t < 0 ? wobbleL : wobbleR) * ragged;
      let a = Math.abs(t) < limit ? 255 : 0;
      // Bites: missing pieces near the edge
      if (a && Math.abs(t) > limit - bites) {
        const n = valueNoise(x * 0.35 + seed * 13, y * 0.12 - seed);
        if (n > 0.62) a = 0;
      }
      // Bare patches (~0.5–2 m) inside the road, grouped by `cluster`.
      if (a && holes && cluster > 0.45) {
        const n =
          valueNoise(x * 0.045 + seed * 5.1, y * 0.04 + seed) * 0.7 +
          valueNoise(x * 0.14 - seed, y * 0.12 + seed * 3) * 0.3;
        if (n > 1 - holes * (cluster - 0.45) * 2) a = 0;
      }
      const p = (y * width + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = a;
      d[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, false, false);
}
