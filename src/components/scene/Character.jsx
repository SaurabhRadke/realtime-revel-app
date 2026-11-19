"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { CHARACTERS } from "./characters";
import { patchLampLight } from "./lampLight";
import { getPlayerState } from "./player";
import { flashLight } from "./sharedLights";
import { cutLimbBridges, limbRotations } from "./rigMath";

// Every character is fetched with the town, so swapping is instant.
for (const c of CHARACTERS) useGLTF.preload(c.url, false);

// ---------------------------------------------------------------------------
// Model prep: bake each static mesh upright, facing +z, feet at y = 0, 1 unit
// tall, centred on its footprint: the same space the rigs in characters.js
// were measured in.
// ---------------------------------------------------------------------------

const bakedCache = new Map();
function bakeCharacter(def, scene) {
  const { url, yaw } = def;
  if (bakedCache.has(url)) return bakedCache.get(url);
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (yaw) g.rotateY(yaw); // make the face look along +z
    parts.push({ geometry: g, material: o.material });
  });
  const box = new Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox);
  }
  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  for (const p of parts) {
    p.geometry.translate(-c.x, -box.min.y, -c.z);
    p.geometry.scale(1 / size.y, 1 / size.y, 1 / size.y);
    // Cut triangles that would tear open between limbs (fused hand-to-foot etc).
    if (p.geometry.index) {
      const { index } = cutLimbBridges(def, p.geometry.attributes.position.array, p.geometry.index.array);
      p.geometry.setIndex(index);
    }
    p.geometry.computeBoundingSphere();
  }
  bakedCache.set(url, parts);
  return parts;
}

// ---------------------------------------------------------------------------
// Character shader additions (on top of the model's own PBR material):
//  * limbs: up to 4 two-bone chains (hip/knee/foot, shoulder/elbow/hand)
//    bend the mesh around the rig's joints. Each vertex is weighted by its
//    distance to the bones, faded out towards the torso and across the body's
//    middle, so the deformation is smooth and the mesh never tears. Normals
//    turn with it so the lighting stays right.
//  * dissolve in (bottom -> top) and out (bottom -> top, as if beamed up),
//    with a glowing, noisy edge in the character's accent colour
// ---------------------------------------------------------------------------

const MAX_LIMBS = 4;

const RIG_GLSL = /* glsl */ `
  uniform vec3 uLimbA[${MAX_LIMBS}];   // hip / shoulder
  uniform vec3 uLimbB[${MAX_LIMBS}];   // knee / elbow
  uniform vec3 uLimbC[${MAX_LIMBS}];   // foot / hand
  uniform vec4 uLimbP[${MAX_LIMBS}];   // radius (<= 0: unused), clip, side, -
  uniform vec2 uLimbFoot[${MAX_LIMBS}]; // footprint half-size (x, z) around c; 0 = none
  uniform vec2 uLimbRot[${MAX_LIMBS}]; // swing (+ = forward), bend at b (+ = lower part back)
  vec3 chRotX(vec3 v, float a) {
    float c = cos(a), s = sin(a);
    return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
  }
  float chSegT(vec3 p, vec3 a, vec3 b) {
    vec3 ab = b - a;
    return dot(p - a, ab) / max(dot(ab, ab), 1e-6);
  }
  float chSegD(vec3 p, vec3 a, vec3 b) {
    float t = clamp(chSegT(p, a, b), 0.0, 1.0);
    return length(p - (a + (b - a) * t));
  }
  void chDeform(inout vec3 p, inout vec3 n) {
    vec3 p0 = p;
    // Distance to each limb's bones; a vertex belongs to the nearest limb
    // (soft at the boundary), so a hand hanging by a leg doesn't drag it.
    float dist[${MAX_LIMBS}];
    for (int i = 0; i < ${MAX_LIMBS}; i++) {
      dist[i] = uLimbP[i].x > 0.0
        ? min(chSegD(p0, uLimbA[i], uLimbB[i]), chSegD(p0, uLimbB[i], uLimbC[i]))
        : 1e3;
      // Feet: everything below the ankle within the footprint is rigid foot
      // (toes and back claws can reach well past the foot bone).
      vec2 fs = uLimbFoot[i];
      if (fs.x > 0.0 && p0.y < uLimbC[i].y + 0.04) {
        vec2 q = (p0.xz - uLimbC[i].xz) / fs;
        if (dot(q, q) < 1.0) dist[i] = 0.0;
      }
    }
    for (int i = 0; i < ${MAX_LIMBS}; i++) {
      vec4 P = uLimbP[i];
      if (P.x <= 0.0) continue;
      vec3 A = uLimbA[i], B = uLimbB[i], C = uLimbC[i];
      float d = dist[i];
      float others = 1e3;
      for (int j = 0; j < ${MAX_LIMBS}; j++) if (j != i) others = min(others, dist[j]);
      float w = 1.0 - smoothstep(P.x, P.x * 1.6, d);
      w *= smoothstep(-0.015, 0.02, others - d);
      w *= smoothstep(-0.35, 0.3, chSegT(p0, A, B));      // fade into the torso above the joint
      w *= smoothstep(P.y, P.y + 0.035, P.z * p0.x);      // only this side of the body
      if (w <= 0.0) continue;
      float lw = w * smoothstep(-0.3, 0.25, chSegT(p0, B, C)); // part below the knee / elbow
      float sw = -uLimbRot[i].x * w;
      p = A + chRotX(p - A, sw);
      n = chRotX(n, sw);
      vec3 Bw = A + chRotX(B - A, sw);
      float bd = uLimbRot[i].y * lw;
      p = Bw + chRotX(p - Bw, bd);
      n = chRotX(n, bd);
    }
  }
`;

const NOISE_GLSL = /* glsl */ `
  float chHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float chNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(chHash(i), chHash(i + vec3(1,0,0)), f.x),
                   mix(chHash(i + vec3(0,1,0)), chHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(chHash(i + vec3(0,0,1)), chHash(i + vec3(1,0,1)), f.x),
                   mix(chHash(i + vec3(0,1,1)), chHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

function patchCharacter(shader, fx) {
  patchLampLight(shader);
  Object.assign(shader.uniforms, fx);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nvarying vec3 vCharPos;\n${RIG_GLSL}`)
    .replace(
      "#include <beginnormal_vertex>",
      /* glsl */ `#include <beginnormal_vertex>
      vec3 chP = position;
      chDeform(chP, objectNormal);
      vCharPos = position;`,
    )
    .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = chP;");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\nuniform float uReveal;\nuniform float uVanish;\nuniform vec3 uGlowColor;\nvarying vec3 vCharPos;\n${NOISE_GLSL}`,
    )
    .replace(
      "#include <clipping_planes_fragment>",
      /* glsl */ `#include <clipping_planes_fragment>
      float chH = vCharPos.y + (chNoise(vCharPos * 11.0) - 0.5) * 0.16;
      float chIn = mix(-0.12, 1.16, uReveal);
      float chOut = mix(-0.12, 1.16, uVanish);
      if (chH > chIn || chH < chOut) discard;
      float chGlow = 0.0;
      if (uReveal < 0.999) chGlow += 1.0 - smoothstep(0.0, 0.06, chIn - chH);
      if (uVanish > 0.001) chGlow += 1.0 - smoothstep(0.0, 0.06, chH - chOut);`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowColor * chGlow * 6.0;",
    );
}

function CharacterBody({ def, fx, bodyRef }) {
  const { scene } = useGLTF(def.url, false);
  const meshes = useMemo(() => {
    return bakeCharacter(def, scene).map(({ geometry, material }) => {
      const m = material.clone();
      m.metalness = 0; // no environment map: metal would read as black
      if ("specularIntensity" in m) m.specularIntensity = 0.45;
      m.onBeforeCompile = (shader) => patchCharacter(shader, fx);
      m.customProgramCacheKey = () => "character";
      return new Mesh(geometry, m);
    });
  }, [def, scene, fx]);
  useEffect(() => () => meshes.forEach((m) => m.material.dispose()), [meshes]);

  return (
    <group ref={bodyRef} scale={def.height}>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Summoning effect: light pillar, ground shockwave, spiralling sparks, flash.
// ---------------------------------------------------------------------------

const SPARKS = 220;

function createSparkGeometry() {
  const angle = [];
  const params = []; // radius, rise speed, delay, size
  const pos = [];
  for (let i = 0; i < SPARKS; i++) {
    angle.push(Math.random() * Math.PI * 2);
    params.push(0.35 + Math.random() * 0.75, 1.2 + Math.random() * 3.2, Math.random() * 0.45, 3 + Math.random() * 7);
    pos.push(0, 0, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aAngle", new Float32BufferAttribute(angle, 1));
  g.setAttribute("aParams", new Float32BufferAttribute(params, 4));
  return g;
}

const sparkVertex = /* glsl */ `
  uniform float uT;      // seconds since the effect started
  uniform float uOut;    // 1 = vanishing (sparks fly up and out), 0 = arriving (spiral in)
  uniform float uPixelRatio;
  attribute float aAngle;
  attribute vec4 aParams;
  varying float vAlpha;
  void main() {
    float t = max(uT - aParams.z, 0.0);
    float life = clamp(t / 1.1, 0.0, 1.0);
    float r = aParams.x * mix(1.0 - life * 0.85, 0.4 + life * 1.4, uOut);
    float a = aAngle + t * mix(5.0, 2.5, uOut);
    float y = aParams.y * t * mix(0.75, 1.0, uOut) + 0.05;
    vec3 p = vec3(cos(a) * r, y, sin(a) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vAlpha = (1.0 - life) * smoothstep(0.0, 0.06, t) * step(0.0001, uT - aParams.z);
    gl_PointSize = aParams.w * uPixelRatio * (8.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const sparkFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-d * d * 4.0) * vAlpha;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45) * a * 2.2, 1.0);
  }
`;

const pillarVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const pillarFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uT;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float fadeUp = pow(1.0 - vUv.y, 1.6);
    float streaks = 0.55 + 0.45 * sin(vUv.x * 62.83 + uT * 3.0) * sin(vUv.y * 9.0 - uT * 14.0);
    float a = fadeUp * streaks * uOpacity;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.25) * a, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float edge = smoothstep(0.0, 0.5, vUv.x) * (1.0 - smoothstep(0.5, 1.0, vUv.x));
    gl_FragColor = vec4(uColor * edge * uOpacity * 1.6, 1.0);
  }
`;

// Ring UVs: x across the band (0 inner .. 1 outer).
function ringGeometry(inner, outer, segments = 96) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos.push(c * inner, 0, s * inner, c * outer, 0, s * outer);
    uv.push(0, i / segments, 1, i / segments);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function useFxMaterials() {
  return useMemo(() => {
    const color = new Color();
    const additive = { transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false };
    const spark = new ShaderMaterial({
      uniforms: { uT: { value: 0 }, uOut: { value: 0 }, uColor: { value: color }, uPixelRatio: { value: 1 } },
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
      ...additive,
    });
    const pillar = new ShaderMaterial({
      uniforms: { uT: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: color } },
      vertexShader: pillarVertex,
      fragmentShader: pillarFragment,
      side: DoubleSide,
      ...additive,
    });
    const ring = new ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColor: { value: color } },
      vertexShader: pillarVertex,
      fragmentShader: ringFragment,
      side: DoubleSide,
      ...additive,
    });
    const ring2 = ring.clone();
    ring2.uniforms.uColor = ring.uniforms.uColor; // clone() copied it; share instead
    return {
      color,
      spark,
      pillar,
      ring,
      ring2,
      sparkGeo: createSparkGeometry(),
      ringGeo: ringGeometry(0.82, 1),
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Swap timeline
//   spawn-wait: hidden while the loading screen fades out
//   out:   current character stretches up and dissolves away, sparks fly up
//   in:    new one materialises bottom-up inside a light pillar, pops into
//          shape with an elastic bounce, shockwave rings across the ground
//   linger: camera holds on the front view a moment, then swings back
// ---------------------------------------------------------------------------

const T_WAIT = 0.75;
const T_OUT = 0.55;
const T_IN = 1.25;
const T_LINGER = 0.7;

const easeOutElastic = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
const easeInCubic = (t) => t * t * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

const _hand = new Vector3();
const _rots = [];
const _a = new Vector3();
const _b = new Vector3();

// Rotation about X, matching chRotX in the shader.
function rotX(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const y = v.y * c - v.z * s;
  v.z = v.y * s + v.z * c;
  v.y = y;
  return v;
}

// Per-frame update (outside the component: it mutates three.js objects and
// uniforms, which React state is not involved in).
function stepCharacter(state, rawDt, c) {
  const { tl, fx, fxm, shown, setShown, def, root, pose, body, pillar, ring1, ring2, sparks, player } = c;
  const dt = Math.min(rawDt, 0.1);
  const s = tl;
  s.t += dt;

  // ---- timeline ----
  if (s.phase === "wait" && s.t > T_WAIT) startIn(s, fxm);
  if (s.phase === "idle" && s.target !== shown) {
    s.phase = "out";
    s.t = 0;
    fxm.spark.uniforms.uOut.value = 1;
    fxm.spark.uniforms.uT.value = 0;
  }
  if (s.phase === "out" && s.t > T_OUT) {
    // Hide the old body before React swaps the model in.
    fx.uVanish.value = 0;
    fx.uReveal.value = 0;
    fx.uGlowColor.value.set(CHARACTERS[s.target].accent);
    setShown(s.target);
    startIn(s, fxm);
  }
  if (s.phase === "in" && s.t > T_IN) {
    s.phase = "linger";
    s.t = 0;
  }
  if (s.phase === "linger" && s.t > T_LINGER) {
    s.phase = "idle";
    s.t = 0;
  }
  player.showcase = s.phase !== "idle";
  fxm.color.set(CHARACTERS[s.phase === "out" ? shown : s.target].accent);

  // ---- body scale envelope + dissolve ----
  let sx = 1;
  let sy = 1;
  let torch = 1;
  if (s.phase === "wait") {
    fx.uReveal.value = 0;
    torch = 0;
  } else if (s.phase === "out") {
    const k = clamp01(s.t / T_OUT);
    fx.uVanish.value = easeInCubic(k) * 1.02;
    sy = 1 + easeInCubic(k) * 0.35;
    sx = 1 - easeInCubic(k) * 0.45;
    torch = 1 - clamp01(k * 2);
  } else if (s.phase === "in") {
    const k = clamp01(s.t / (T_IN * 0.8));
    fx.uReveal.value = clamp01(s.t / (T_IN * 0.7));
    const pop = easeOutElastic(clamp01((s.t - 0.1) / (T_IN * 0.9)));
    sx = 0.55 + 0.45 * pop;
    sy = 1.3 - 0.3 * pop;
    torch = clamp01((k - 0.6) / 0.4);
  } else {
    fx.uReveal.value = 1;
    fx.uVanish.value = 0;
  }
  player.torchScale = torch;

  // ---- follow the player ----
  const r = root.current;
  if (!r) return;
  r.position.copy(player.position);
  r.rotation.y = player.bodyYaw + Math.PI; // baked models face +Z; bodyYaw 0 faces -Z
  player.eyeHeight = def.height * 0.94;
  player.height = def.height;

  // Hidden in first person (except while a swap is being shown).
  r.visible = !player.firstPerson || s.phase !== "idle";

  // ---- procedural walk ----
  // walkPhase advances PI per step; sin(ph) > 0 means the left leg is ahead.
  const walkTarget = Math.min(1.25, player.speed / 3);
  const turnTarget = Math.min(1, Math.abs(player.turnRate) / 2.5) * (1 - Math.min(1, walkTarget));
  s.walk += (walkTarget - s.walk) * (1 - Math.exp(-8 * dt));
  s.turn += (turnTarget - s.turn) * (1 - Math.exp(-8 * dt));
  const amt = Math.min(1.25, s.walk + s.turn * 0.6); // stepping in place while turning
  const ph = player.walkPhase;
  const step = Math.sin(ph);
  const t = state.clock.elapsedTime;

  // Whole body: highest as the legs pass each other, lowest at heel strike;
  // weight shifts over the standing leg; a slight lean into the walk.
  const p = pose.current;
  const passing = 0.5 + 0.5 * Math.cos(2 * ph);
  p.position.y = passing * 0.022 * amt * def.height;
  p.rotation.z = -step * 0.03 * amt;
  p.rotation.y = step * 0.05 * amt; // shoulders twist against the hips
  p.rotation.x = 0.06 * Math.min(1, s.walk);
  const breathe = Math.sin(t * 2.1) * 0.007 * (1 - Math.min(1, amt));
  const squash = 1 - 0.015 * amt * (1 - passing) + breathe;
  p.scale.set(sx / Math.sqrt(squash), sy * squash, sx / Math.sqrt(squash));

  // Limbs: the same gait maths the bridge check used (rigMath.js).
  const hold = player.torchScale; // torch arm comes up as the torch appears
  const rots = limbRotations(def, ph, amt, hold, s.aimPitch, _rots);
  for (let i = 0; i < MAX_LIMBS; i++) {
    const L = def.limbs[i];
    const prm = fx.uLimbP.value[i];
    if (!L) {
      prm.set(-1, 0, 0, 0);
      continue;
    }
    fx.uLimbA.value[i].fromArray(L.a);
    fx.uLimbB.value[i].fromArray(L.b);
    fx.uLimbC.value[i].fromArray(L.c);
    prm.set(L.r, L.clip, L.side, 0);
    if (L.foot) fx.uLimbFoot.value[i].fromArray(L.foot);
    else fx.uLimbFoot.value[i].set(0, 0);
    fx.uLimbRot.value[i].set(rots[i][0], rots[i][1]);
  }

  // ---- torch grip, for the Torch component ----
  // Same bone maths as the shader, applied to the grip point.
  if (body.current) {
    r.updateMatrixWorld(true);
    _hand.fromArray(def.grip);
    const ti = def.limbs.findIndex((L) => L.kind === "torch");
    if (ti >= 0) {
      const L = def.limbs[ti];
      const [swing, bend] = fx.uLimbRot.value[ti].toArray();
      _a.fromArray(L.a);
      _hand.sub(_a);
      rotX(_hand, -swing).add(_a);
      _b.fromArray(L.b).sub(_a);
      rotX(_b, -swing).add(_a);
      _hand.sub(_b);
      rotX(_hand, bend).add(_b);
    }
    body.current.localToWorld(_hand);
    player.hand.copy(_hand);

    // Aim pitch from the hand, for next frame's arm raise.
    const dx = player.aim.x - _hand.x;
    const dz = player.aim.z - _hand.z;
    const target = Math.max(-0.9, Math.min(0.6, Math.atan2(player.aim.y - _hand.y, Math.hypot(dx, dz))));
    s.aimPitch += (target - s.aimPitch) * (1 - Math.exp(-8 * dt));
  }

  // ---- effect visuals ----
  const sparkU = fxm.spark.uniforms;
  sparkU.uT.value += dt;
  sparkU.uPixelRatio.value = state.viewport.dpr;
  let pillarA = 0;
  let ringK = -1;
  let flashI = 0;
  if (s.phase === "in") {
    pillarA = Math.min(1, s.t / 0.15) * (1 - clamp01((s.t - 0.6) / 0.6));
    ringK = clamp01((s.t - 0.25) / 0.9);
    flashI = Math.max(0, 1 - Math.abs(s.t - 0.35) / 0.5) * 9;
  } else if (s.phase === "out") {
    pillarA = clamp01(s.t / T_OUT) * 0.6;
    flashI = clamp01(s.t / T_OUT) * 4;
  }
  fxm.pillar.uniforms.uOpacity.value = pillarA;
  fxm.pillar.uniforms.uT.value = t;
  if (pillar.current) {
    pillar.current.visible = pillarA > 0.001;
    pillar.current.scale.set(1 - pillarA * 0.15 + 0.15, 1, 1 - pillarA * 0.15 + 0.15);
  }
  for (const [ref, delay] of [
    [ring1, 0],
    [ring2, 0.18],
  ]) {
    const m = ref.current;
    if (!m) continue;
    const k = ringK < 0 ? -1 : clamp01((ringK - delay) / (1 - delay));
    m.visible = k > 0 && k < 1;
    if (m.visible) {
      m.scale.setScalar(0.4 + k * 4.2);
      m.material.uniforms.uOpacity.value = (1 - k) * (1 - k);
    }
  }
  if (sparks.current) sparks.current.visible = s.phase === "out" || s.phase === "in" || s.phase === "linger";
  // One shared flash light for every character (see sharedLights.js): a
  // light per character would recompile every material when players join.
  if (flashI > flashLight.intensity) {
    flashLight.intensity = flashI;
    flashLight.color.copy(fxm.color);
    flashLight.position.set(r.position.x, 1.3, r.position.z);
  }
}

export default function Character({ id, slot = 0, index }) {
  const player = getPlayerState(id, slot);
  const [shown, setShown] = useState(index);
  const def = CHARACTERS[shown];

  // Dissolve uniforms are shared by every material of whichever body is shown.
  const fx = useMemo(
    () => ({
      uReveal: { value: 0 },
      uVanish: { value: 0 },
      uGlowColor: { value: new Color(def.accent) },
      uLimbA: { value: Array.from({ length: MAX_LIMBS }, () => new Vector3()) },
      uLimbB: { value: Array.from({ length: MAX_LIMBS }, () => new Vector3()) },
      uLimbC: { value: Array.from({ length: MAX_LIMBS }, () => new Vector3()) },
      uLimbP: { value: Array.from({ length: MAX_LIMBS }, () => new Vector4(-1, 0, 0, 0)) },
      uLimbRot: { value: Array.from({ length: MAX_LIMBS }, () => new Vector2()) },
      uLimbFoot: { value: Array.from({ length: MAX_LIMBS }, () => new Vector2()) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const fxm = useFxMaterials();
  useEffect(
    () => () => {
      for (const k of ["spark", "pillar", "ring", "ring2", "sparkGeo", "ringGeo"]) fxm[k].dispose();
    },
    [fxm],
  );

  const root = useRef(null);
  const pose = useRef(null); // walk animation transforms
  const body = useRef(null);
  const pillar = useRef(null);
  const ring1 = useRef(null);
  const ring2 = useRef(null);
  const sparks = useRef(null);
  const tl = useRef({ phase: "wait", t: 0, target: index, walk: 0, turn: 0, aimPitch: -0.2 });

  // Retarget when the picker changes (also mid-swap: it just plays on).
  useEffect(() => {
    tl.current.target = index;
  }, [index]);

  useFrame(
    (state, dt) =>
      stepCharacter(state, dt, {
        tl: tl.current,
        fx,
        fxm,
        shown,
        setShown,
        def,
        root,
        pose,
        body,
        pillar,
        ring1,
        ring2,
        sparks,
        player,
      }),
    -2,
  );

  return (
    <group ref={root}>
      <group ref={pose}>
        <CharacterBody key={def.id} def={def} fx={fx} bodyRef={body} />
      </group>
      <mesh ref={pillar} material={fxm.pillar} position={[0, 3.2, 0]} visible={false} renderOrder={5}>
        <cylinderGeometry args={[0.7, 0.95, 6.4, 40, 1, true]} />
      </mesh>
      <mesh ref={ring1} geometry={fxm.ringGeo} material={fxm.ring} position={[0, 0.05, 0]} visible={false} />
      <mesh ref={ring2} geometry={fxm.ringGeo} material={fxm.ring2} position={[0, 0.05, 0]} visible={false} />
      <points ref={sparks} geometry={fxm.sparkGeo} material={fxm.spark} frustumCulled={false} visible={false} />
    </group>
  );
}

function startIn(s, fxm) {
  s.phase = "in";
  s.t = 0;
  fxm.spark.uniforms.uOut.value = 0;
  fxm.spark.uniforms.uT.value = 0;
}
