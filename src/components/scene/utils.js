// Small deterministic helpers (no deps) so the field looks the same every load.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

// Smooth 2D value noise in [0, 1].
export function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// Two-octave fractal noise in [0, 1].
export function fbm(x, y) {
  return valueNoise(x, y) * 0.65 + valueNoise(x * 2.3 + 17.1, y * 2.3 - 4.7) * 0.35;
}

// ---- Seamlessly tiling noise for repeating textures ----

function hashPeriodic(ix, iy, period, seed) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  return hash2(x + seed * 17.13, y - seed * 9.71);
}

// Value noise that repeats every `period` units in x and y.
export function periodicNoise(x, y, period, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashPeriodic(ix, iy, period, seed);
  const b = hashPeriodic(ix + 1, iy, period, seed);
  const c = hashPeriodic(ix, iy + 1, period, seed);
  const d = hashPeriodic(ix + 1, iy + 1, period, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Precomputes a tiling noise field at low resolution, then returns a cheap
 * bilinear sampler over u, v in [0, 1) (wrapping). Much faster than evaluating
 * noise for every pixel of a large canvas.
 */
export function tilingNoiseField(frequency, seed, res = 256) {
  const data = new Float32Array(res * res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      data[y * res + x] = periodicNoise((x / res) * frequency, (y / res) * frequency, frequency, seed);
    }
  }
  return (u, v) => {
    const fx = u * res;
    const fy = v * res;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = ((x0 % res) + res) % res;
    const ya = ((y0 % res) + res) % res;
    const xb = (xa + 1) % res;
    const yb = (ya + 1) % res;
    const top = data[ya * res + xa] * (1 - tx) + data[ya * res + xb] * tx;
    const bot = data[yb * res + xa] * (1 - tx) + data[yb * res + xb] * tx;
    return top * (1 - ty) + bot * ty;
  };
}
