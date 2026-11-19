// CPU mirror of the character rig's vertex weighting (see RIG_GLSL in
// Character.jsx). Used at load time to cut accidental bridges between limbs
// (AI-generated meshes sometimes fuse e.g. a hanging hand to a foot), which
// would otherwise stretch into sheets as the limbs move apart.

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function segT(px, py, pz, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const d = abx * abx + aby * aby + abz * abz;
  return ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / Math.max(d, 1e-6);
}

function segD(px, py, pz, a, b) {
  const t = Math.min(1, Math.max(0, segT(px, py, pz, a, b)));
  const qx = a[0] + (b[0] - a[0]) * t - px;
  const qy = a[1] + (b[1] - a[1]) * t - py;
  const qz = a[2] + (b[2] - a[2]) * t - pz;
  return Math.hypot(qx, qy, qz);
}

/** Weight of each limb at point (x, y, z), exactly as the shader computes it. */
export function limbWeights(x, y, z, limbs, out = []) {
  const dist = limbs.map((L) => {
    if (L.foot && y < L.c[1] + 0.04) {
      const qx = (x - L.c[0]) / L.foot[0];
      const qz = (z - L.c[2]) / L.foot[1];
      if (qx * qx + qz * qz < 1) return 0;
    }
    return Math.min(segD(x, y, z, L.a, L.b), segD(x, y, z, L.b, L.c));
  });
  limbs.forEach((L, i) => {
    let others = 1e3;
    for (let j = 0; j < dist.length; j++) if (j !== i) others = Math.min(others, dist[j]);
    let w = 1 - smooth(L.r, L.r * 1.6, dist[i]);
    w *= smooth(-0.015, 0.02, others - dist[i]);
    w *= smooth(-0.35, 0.3, segT(x, y, z, L.a, L.b));
    w *= smooth(L.clip, L.clip + 0.035, L.side * x);
    out[i] = w;
  });
  return out;
}

/**
 * Limb rotations for a moment of the walk: [swing, bend] per limb.
 *   ph        step clock (PI per step; sin > 0 = left leg ahead)
 *   amt       0 standing .. ~1.25 running
 *   hold      0..1 how far the torch arm is raised
 *   aimPitch  radians, torch aim above (+) / below (-) the horizon
 */
export function limbRotations(def, ph, amt, hold, aimPitch, out = []) {
  const step = Math.sin(ph);
  def.limbs.forEach((L, i) => {
    let swing;
    let bend;
    if (L.kind === "leg") {
      // Hip swings the leg through; the knee lifts the foot while it travels forward.
      const forward = L.side * Math.cos(ph);
      swing = L.side * step * 0.42 * amt;
      bend = (Math.max(0, forward) * 0.75 + 0.06) * amt;
    } else if (L.kind === "arm") {
      swing = -L.side * step * 0.38 * amt; // opposite the same-side leg
      bend = -0.25 * amt; // soft elbow
    } else {
      // Torch arm: held out in front, tilted with the aim, steadied while walking.
      swing = (def.raise + aimPitch * 0.75) * hold + step * 0.04 * amt;
      bend = -0.35 * hold;
    }
    out[i] = [swing, bend];
  });
  return out;
}

function rotXAbout(p, o, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const y = p[1] - o[1];
  const z = p[2] - o[2];
  p[1] = o[1] + y * c - z * s;
  p[2] = o[2] + y * s + z * c;
}

/** Deforms point p (array, in place) exactly like chDeform in the shader. */
export function deformPoint(p, limbs, rots, weights = limbWeights(p[0], p[1], p[2], limbs)) {
  const p0 = [p[0], p[1], p[2]];
  limbs.forEach((L, i) => {
    const w = weights[i];
    if (w <= 0) return;
    const lw = w * smooth(-0.3, 0.25, segT(p0[0], p0[1], p0[2], L.b, L.c));
    const sw = -rots[i][0] * w;
    rotXAbout(p, L.a, sw);
    const B = [L.b[0], L.b[1], L.b[2]];
    rotXAbout(B, L.a, sw);
    rotXAbout(p, B, rots[i][1] * lw);
  });
  return p;
}

/**
 * Returns a copy of `index` without the triangles that tear open when the
 * limbs move: each triangle is checked in the extreme walk / torch poses, and
 * dropped if any edge stretches to several times its resting length. Those
 * are accidental bridges (e.g. a hanging hand fused to a foot); real joints
 * only stretch a little. Positions are in the rig's normalised space.
 */
export function cutLimbBridges(def, positions, index) {
  const n = positions.length / 3;
  const weights = [];
  for (let v = 0; v < n; v++) {
    weights.push(limbWeights(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], def.limbs));
  }
  const poses = [
    [Math.PI / 2, 1.25, 1, -0.9],
    [(3 * Math.PI) / 2, 1.25, 1, 0.6],
    [0, 1.25, 1, -0.4],
    [Math.PI, 1.25, 0, 0],
  ].map(([ph, amt, hold, pitch]) => {
    const rots = limbRotations(def, ph, amt, hold, pitch);
    const out = new Float32Array(n * 3);
    const p = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      p[0] = positions[v * 3];
      p[1] = positions[v * 3 + 1];
      p[2] = positions[v * 3 + 2];
      deformPoint(p, def.limbs, rots, weights[v]);
      out[v * 3] = p[0];
      out[v * 3 + 1] = p[1];
      out[v * 3 + 2] = p[2];
    }
    return out;
  });

  const len = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const kept = [];
  let removed = 0;
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]];
    let tear = false;
    for (let e = 0; e < 3 && !tear; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const rest = len(positions, a, b);
      for (const P of poses) {
        const d = len(P, a, b);
        if (d > rest * 3 + 0.02) {
          tear = true;
          break;
        }
      }
    }
    if (tear) removed++;
    else kept.push(tri[0], tri[1], tri[2]);
  }
  return { index: kept, removed };
}
