"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import SCENE_MODELS from "./sceneModels.json";
import { FIELD_RADIUS, MUD_VERGE, ROAD_WIDTH } from "./config";
import { getPlayerState, playerStates } from "./player";
import { getPlayers } from "./roster";
import { COIN_COUNT, KEYS_TOTAL, SENSE_LEVELS, collectCoin, collectKey, game, getGame, openChest, setKeySense, tickGame } from "./game";
import { flashLight } from "./sharedLights";
import { TORCH } from "./torchLight";
import { isInsideHouse } from "./townLayout";

const url = (kind) => SCENE_MODELS.find((m) => m.kind === kind)?.url;
const COIN_URL = url("coin");
const KEY_URL = url("key");
const CHEST_URL = url("chest");
for (const u of [COIN_URL, KEY_URL, CHEST_URL]) if (u) useGLTF.preload(u, false);

// ---- Tuning ----
const COIN_SIZE = 0.5; // metres across
const KEY_SIZE = 0.9; // metres tall
const CHEST_SIZE = 1.5; // metres wide
const CHEST_POS = new Vector3(0, 0, 0); // the crossroads
const COIN_MAGNET = 2.3; // coins within this drift towards you...
const COIN_PICK = 0.6; // ...and are yours once this close
const COIN_POP = 0.55; // seconds of the pickup flourish
const KEY_PICK = 1.4;
const KEY_HOVER = 0.85; // keys float above the grass tips
const CHEST_PICK = 2.0;
const REVEAL_NEAR = 4.5; // a key shows itself to anyone this close...
const REVEAL_BEAM = 26; // ...or to a torch beam within this range
const REVEAL_CONE = Math.cos(TORCH.angle * 1.6);
const REVEAL_HOLD = 4; // seconds a key stays visible after the light leaves it
const ROAD_OUTER = ROAD_WIDTH / 2 + MUD_VERGE;
// Key sense (hot/cold) thresholds, metres to the nearest hidden key: burning, hot, warm, cool.
const SENSE_DIST = [5, 10, 17, 26];
// Fireflies: a swarm around every key, plus decoy swarms over empty dark spots.
const WISPS_PER_SWARM = 6;
const DECOYS = 3;
const SWARMS = KEYS_TOTAL + DECOYS;
const GOLD_COLOR = new Color("#ffd36e");
const KEY_COLOR = new Color("#ffe7a8");
const CHEST_COLOR = new Color("#ffb347");

// ---------------------------------------------------------------------------
// Model prep: one mesh per file, stood up, centred, feet at y = 0, scaled.
// ---------------------------------------------------------------------------
function prepModel(scene, { rotateX = 0, size, by = "max", emissive, emissiveIntensity = 0 }) {
  scene.updateMatrixWorld(true);
  let mesh = null;
  scene.traverse((o) => {
    if (!mesh && o.isMesh) mesh = o;
  });
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  if (rotateX) geometry.rotateX(rotateX);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const dims = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  geometry.translate(-c.x, -box.min.y, -c.z);
  const ref = by === "x" ? dims.x : by === "y" ? dims.y : Math.max(dims.x, dims.y, dims.z);
  geometry.scale(size / ref, size / ref, size / ref);
  geometry.computeBoundingSphere();
  const material = mesh.material.clone();
  material.metalness = Math.min(material.metalness ?? 0, 0.25); // no env map: metal reads black
  if (emissive) {
    material.emissive = new Color(emissive);
    material.emissiveIntensity = emissiveIntensity;
  }
  return { geometry, material };
}

function useModel(u, opts) {
  const { scene } = useGLTF(u, false);
  const res = useMemo(() => prepModel(scene, opts), [scene]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      res.geometry.dispose();
      res.material.dispose();
    },
    [res],
  );
  return res;
}

// ---------------------------------------------------------------------------
// Scattering: coins along roads and through the grass, keys hidden in the dark
// quadrants between the roads (away from the lamps), one per quadrant.
// ---------------------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);

function scatter(count, pick, minGap, tries = 4000) {
  const out = [];
  for (let t = 0; t < tries && out.length < count; t++) {
    const p = pick();
    if (!p) continue;
    if (Math.hypot(p.x - CHEST_POS.x, p.z - CHEST_POS.z) < 3.5) continue;
    if (isInsideHouse(p.x, p.z, 0.9)) continue;
    if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < minGap)) continue;
    out.push(p);
  }
  return out;
}

function makeRound() {
  const maxR = FIELD_RADIUS - 3;
  const coins = scatter(
    COIN_COUNT,
    () => {
      if (Math.random() < 0.55) {
        // Along a road, wobbling across its width.
        const along = rand(-maxR, maxR);
        const across = rand(-ROAD_OUTER, ROAD_OUTER) * 0.8;
        return Math.random() < 0.5 ? { x: across, z: along } : { x: along, z: across };
      }
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(rand(0.02, 1)) * maxR;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    },
    2.6,
  ).map((p, i) => ({ ...p, px: p.x, pz: p.z, pull: 0, taken: false, takenAt: 0, by: null, y0: 0, spin0: 0, done: false, phase: i * 0.7 }));

  // Keys: three of the four dark quadrants, deep enough off the roads.
  const quadrants = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].sort(() => Math.random() - 0.5);
  const keys = [];
  for (const [sx, sz] of quadrants) {
    if (keys.length >= KEYS_TOTAL) break;
    const [spot] = scatter(
      1,
      () => {
        const x = sx * rand(ROAD_OUTER + 3, maxR - 2);
        const z = sz * rand(ROAD_OUTER + 3, maxR - 2);
        return Math.hypot(x, z) < maxR - 1 && Math.hypot(x, z) > 9 ? { x, z } : null;
      },
      0,
    );
    if (spot) keys.push({ ...spot, found: false, foundAt: 0, reveal: 0, litAt: -1e9, announced: false });
  }

  // Decoy firefly swarms: dark spots that look just like a key's swarm from
  // afar. Only the torch (or the key sense meter) tells them apart.
  const decoys = scatter(
    DECOYS,
    () => {
      const a = rand(0, Math.PI * 2);
      const r = rand(12, maxR - 2);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < ROAD_OUTER + 2.5 || Math.abs(z) < ROAD_OUTER + 2.5) return null;
      if (keys.some((k) => Math.hypot(k.x - x, k.z - z) < 14)) return null;
      return { x, z };
    },
    14,
  );
  const swarms = [...keys, ...decoys].map((at, s) => ({
    at,
    wisps: Array.from({ length: WISPS_PER_SWARM }, (_, w) => ({
      r: rand(1.0, 2.8),
      speed: rand(0.35, 0.9) * (w % 2 ? 1 : -1),
      h: rand(0.7, 2.2),
      ph: rand(0, Math.PI * 2) + s,
    })),
  }));
  return { coins, keys, swarms };
}

// ---------------------------------------------------------------------------
// Sparkle bursts (pickups, chest opening): one small CPU particle pool.
// ---------------------------------------------------------------------------
const SPARKS = 320;
const sparkVertex = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  varying float vLife;
  uniform float uPixelRatio;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (10.0 / -mv.z) * (0.4 + 0.6 * aLife);
    gl_Position = projectionMatrix * mv;
  }
`;
const sparkFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vLife;
  void main() {
    if (vLife <= 0.0) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-d * d * 4.0) * vLife;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4) * a * 2.0, 1.0);
  }
`;

function createPoints(count, minSize, maxSize, color) {
  const g = new BufferGeometry();
  const pos = new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
  const life = new BufferAttribute(new Float32Array(count), 1).setUsage(DynamicDrawUsage);
  const size = new BufferAttribute(new Float32Array(count), 1);
  for (let i = 0; i < count; i++) size.array[i] = rand(minSize, maxSize);
  g.setAttribute("position", pos);
  g.setAttribute("aLife", life);
  g.setAttribute("aSize", size);
  const m = new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uPixelRatio: { value: 1 } },
    vertexShader: sparkVertex,
    fragmentShader: sparkFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const vel = new Float32Array(count * 3);
  return { geometry: g, material: m, vel, next: 0 };
}

const createSparks = () => createPoints(SPARKS, 3, 9, "#ffcf5a");
const createWisps = () => createPoints(SWARMS * WISPS_PER_SWARM, 10, 16, "#d8ff9a");

function burst(sp, at, count, speed, up) {
  const pos = sp.geometry.attributes.position.array;
  const life = sp.geometry.attributes.aLife.array;
  for (let k = 0; k < count; k++) {
    const i = sp.next;
    sp.next = (sp.next + 1) % SPARKS;
    const a = Math.random() * Math.PI * 2;
    const s = speed * rand(0.3, 1);
    pos[i * 3] = at.x;
    pos[i * 3 + 1] = at.y;
    pos[i * 3 + 2] = at.z;
    sp.vel[i * 3] = Math.cos(a) * s;
    sp.vel[i * 3 + 1] = up * rand(0.5, 1.2);
    sp.vel[i * 3 + 2] = Math.sin(a) * s;
    life[i] = 1;
  }
}

function stepSparks(sp, dt) {
  const pos = sp.geometry.attributes.position.array;
  const life = sp.geometry.attributes.aLife.array;
  let any = false;
  for (let i = 0; i < SPARKS; i++) {
    if (life[i] <= 0) continue;
    any = true;
    life[i] -= dt * 0.9;
    sp.vel[i * 3 + 1] -= 6 * dt;
    pos[i * 3] += sp.vel[i * 3] * dt;
    pos[i * 3 + 1] = Math.max(0.05, pos[i * 3 + 1] + sp.vel[i * 3 + 1] * dt);
    pos[i * 3 + 2] += sp.vel[i * 3 + 2] * dt;
  }
  if (any) {
    sp.geometry.attributes.position.needsUpdate = true;
    sp.geometry.attributes.aLife.needsUpdate = true;
  }
  return any;
}

// Soft vertical beam of light (unlocked chest, revealed keys).
const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.5);
    float streak = 0.6 + 0.4 * sin(vUv.x * 50.0 + uTime * 2.0) * sin(vUv.y * 7.0 - uTime * 4.0);
    gl_FragColor = vec4(uColor * fade * streak * uOpacity, 1.0);
  }
`;
const makeBeamMaterial = (color) =>
  new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

// ---------------------------------------------------------------------------
// Pickup flourish: a light flash, ground shockwave rings and "+N" popups.
// Small fixed pools, recycled round-robin; nothing is created mid-game.
// ---------------------------------------------------------------------------
const RINGS = 8;
const POPUPS = 8;
const RING_LIFE = 0.7;
const POPUP_LIFE = 1.1;

function labelTexture(text, color) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  const family = getComputedStyle(document.body).fontFamily || "Georgia, serif";
  ctx.font = `92px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(30, 16, 0, 0.9)";
  ctx.strokeText(text, 128, 70);
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 70);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function createFx() {
  const group = new Group();
  const ringGeo = new RingGeometry(0.82, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = Array.from({ length: RINGS }, () => {
    const m = new Mesh(
      ringGeo,
      new MeshBasicMaterial({ color: GOLD_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
    );
    m.visible = false;
    m.renderOrder = 6;
    m.userData = { t0: -1, size: 1 };
    group.add(m);
    return m;
  });
  const popups = Array.from({ length: POPUPS }, () => {
    const sp = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    sp.visible = false;
    sp.renderOrder = 10;
    sp.userData = { t0: -1, y0: 0, size: 1 };
    group.add(sp);
    return sp;
  });
  return { group, ringGeo, rings, popups, nextRing: 0, nextPopup: 0, textures: {}, flashes: [] };
}

function disposeFx(fx) {
  fx.ringGeo.dispose();
  for (const r of fx.rings) r.material.dispose();
  for (const p of fx.popups) p.material.dispose();
  for (const t of Object.values(fx.textures)) t.dispose();
}

function shockwave(fx, t, x, z, color, size = 1, delay = 0) {
  const r = fx.rings[fx.nextRing];
  fx.nextRing = (fx.nextRing + 1) % RINGS;
  r.position.set(x, 0.06, z);
  r.material.color.copy(color);
  r.userData.t0 = t + delay;
  r.userData.size = size;
}

function popup(fx, t, x, y, z, text, color, size = 1) {
  const key = `${text}|${color}`;
  fx.textures[key] ??= labelTexture(text, color);
  const sp = fx.popups[fx.nextPopup];
  fx.nextPopup = (fx.nextPopup + 1) % POPUPS;
  if (sp.material.map !== fx.textures[key]) {
    sp.material.map = fx.textures[key];
    sp.material.needsUpdate = true;
  }
  sp.position.set(x, y, z);
  sp.userData.t0 = t;
  sp.userData.y0 = y;
  sp.userData.size = size;
}

function flash(fx, t, x, y, z, intensity, color, duration) {
  fx.flashes.push({ x, y, z, t0: t, intensity, color, duration });
}

function stepFx(fx, t) {
  for (const r of fx.rings) {
    const age = t - r.userData.t0;
    if (r.userData.t0 < 0 || age < 0 || age > RING_LIFE) {
      r.visible = false;
      continue;
    }
    const k = age / RING_LIFE;
    r.visible = true;
    r.scale.setScalar((0.25 + (1 - (1 - k) ** 3) * 2.1) * r.userData.size);
    r.material.opacity = (1 - k) ** 1.5 * 0.9;
  }
  for (const sp of fx.popups) {
    const age = t - sp.userData.t0;
    if (sp.userData.t0 < 0 || age > POPUP_LIFE) {
      sp.visible = false;
      continue;
    }
    const k = age / POPUP_LIFE;
    sp.visible = true;
    sp.position.y = sp.userData.y0 + (1 - (1 - k) ** 2) * 1.3;
    const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.55 : 1.15 - (k - 0.15) * 0.25;
    sp.scale.set(1.1 * pop * sp.userData.size, 0.55 * pop * sp.userData.size, 1);
    sp.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
  }
  // The brightest live flash bids for the shared flash light (LightPool).
  let best = null;
  let bestI = 0;
  for (let i = fx.flashes.length - 1; i >= 0; i--) {
    const f = fx.flashes[i];
    const k = (t - f.t0) / f.duration;
    if (k >= 1) {
      fx.flashes.splice(i, 1);
      continue;
    }
    const I = f.intensity * (k < 0.12 ? k / 0.12 : (1 - k) ** 2);
    if (I > bestI) {
      bestI = I;
      best = f;
    }
  }
  if (best && bestI > flashLight.intensity) {
    flashLight.intensity = bestI;
    flashLight.color.copy(best.color);
    flashLight.position.set(best.x, best.y, best.z);
  }
}

// ---------------------------------------------------------------------------

const _m = new Matrix4();
const _o = new Object3D();
const _v = new Vector3();
const _at = new Vector3();

function keyIsLit(k, players) {
  for (const p of players) {
    if (Math.hypot(p.position.x - k.x, p.position.z - k.z) < REVEAL_NEAR) return true;
    if (p.torchOn < 0.5) continue;
    _v.set(k.x - p.lens.x, 0.7 - p.lens.y, k.z - p.lens.z);
    const d = _v.length();
    if (d > REVEAL_BEAM || d < 1e-3) continue;
    if (_v.dot(p.beamDir) / d > REVEAL_CONE) return true;
  }
  return false;
}

// Per-frame update (outside the component: it mutates three.js objects and
// the round's item list, which React state is not involved in).
function stepTreasure(state, rawDt, c) {
  const { items, sparks, wisps, keyBeamMat, chestBeamMat, coinsRef, keyRefs, keyGlowRefs, chestRef, chestBeam, sparksRef, wispsRef, chestFx, fx, chestDeco, showItems } = c;
  const dt = Math.min(rawDt, 0.1);
  const t = state.clock.elapsedTime;
  tickGame();
  const s = getGame();
  const running = s.phase === "hunt" || s.phase === "unlocked";
  const entries = getPlayers();
  const players = entries.map((e) => getPlayerState(e.id, e.slot));

  // ---- coins: drift to whoever is close, then pop up in a burst of light ----
  const cm = coinsRef.current;
  if (cm) {
    items.coins.forEach((c, i) => {
      let y = 0.55 + Math.sin(t * 2 + c.phase) * 0.08;
      let sc = 1;
      let spin = t * 2.4 + c.phase;
      if (c.taken) {
        const k = Math.min(1, (t - c.takenAt) / COIN_POP);
        const p = playerStates.get(c.by);
        if (p) {
          const f = 1 - Math.exp(-12 * dt); // trails the collector
          c.px += (p.position.x - c.px) * f;
          c.pz += (p.position.z - c.pz) * f;
        }
        y = c.y0 + (1 - (1 - k) ** 3) * 1.9;
        sc = k < 0.3 ? 1 + (k / 0.3) * 0.6 : 1.6 * (1 - (k - 0.3) / 0.7) ** 2;
        spin = c.spin0 + k * k * 22;
        if (k >= 1 && !c.done) {
          c.done = true;
          burst(sparks, _at.set(c.px, y, c.pz), 14, 1.8, 2.2);
        }
      } else if (running) {
        let best = -1;
        let bestD = COIN_MAGNET;
        for (let j = 0; j < players.length; j++) {
          const d = Math.hypot(players[j].position.x - c.px, players[j].position.z - c.pz);
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
        if (best >= 0) {
          const p = players[best];
          c.pull = Math.min(1, c.pull + dt * 3);
          const f = 1 - Math.exp(-(3 + 12 * c.pull) * dt);
          c.px += (p.position.x - c.px) * f;
          c.pz += (p.position.z - c.pz) * f;
          y += c.pull * 0.45;
          if (Math.hypot(p.position.x - c.px, p.position.z - c.pz) < COIN_PICK) {
            c.taken = true;
            c.takenAt = t;
            c.by = entries[best].id;
            c.y0 = y;
            c.spin0 = spin;
            collectCoin(entries[best].id);
            burst(sparks, _at.set(c.px, y, c.pz), 18, 2.2, 3.2);
            shockwave(fx, t, c.px, c.pz, GOLD_COLOR, 0.8);
            popup(fx, t, c.px, y + 1.2, c.pz, "+1", "#ffd36e", 0.8);
            flash(fx, t, c.px, 1.3, c.pz, 6, GOLD_COLOR, 0.4);
          }
        } else {
          c.pull = Math.max(0, c.pull - dt * 2);
          const f = 1 - Math.exp(-1.5 * dt); // nobody near: float back home
          c.px += (c.x - c.px) * f;
          c.pz += (c.z - c.pz) * f;
        }
      }
      _o.position.set(c.px, y, c.pz);
      _o.rotation.set(0, spin, 0);
      _o.scale.setScalar(Math.max(1e-4, sc));
      _o.updateMatrix();
      cm.setMatrixAt(i, _o.matrix);
    });
    for (let i = items.coins.length; i < COIN_COUNT; i++) cm.setMatrixAt(i, _m.makeScale(0, 0, 0));
    cm.instanceMatrix.needsUpdate = true;
    cm.visible = showItems;
  }

  // ---- keys: hidden until a torch beam (or someone close by) finds them ----
  items.keys.forEach((k, i) => {
    const mesh = keyRefs.current[i];
    const glow = keyGlowRefs.current[i];
    if (!mesh) return;
    if (running && !k.found) {
      if (keyIsLit(k, players)) k.litAt = t;
      const target = t - k.litAt < REVEAL_HOLD ? 1 : 0;
      k.reveal += (target - k.reveal) * (1 - Math.exp(-(target ? 6 : 1.5) * dt));
      if (!k.announced && k.reveal > 0.5) {
        // First time anyone lights it: a chime of light so everyone notices.
        k.announced = true;
        shockwave(fx, t, k.x, k.z, KEY_COLOR, 1.6);
        flash(fx, t, k.x, 2, k.z, 7, KEY_COLOR, 0.7);
        burst(sparks, _at.set(k.x, KEY_HOVER + 0.4, k.z), 24, 1.2, 3);
      }
      if (s.phase === "hunt" && k.reveal > 0.35) {
        for (let j = 0; j < players.length; j++) {
          const p = players[j];
          if (Math.hypot(p.position.x - k.x, p.position.z - k.z) < KEY_PICK) {
            k.found = true;
            k.foundAt = t;
            collectKey(entries[j]);
            burst(sparks, _at.set(k.x, KEY_HOVER + 0.4, k.z), 60, 2.8, 4.5);
            shockwave(fx, t, k.x, k.z, KEY_COLOR, 1.5);
            shockwave(fx, t, k.x, k.z, GOLD_COLOR, 2.4, 0.15);
            popup(fx, t, k.x, KEY_HOVER + 1.8, k.z, "+5", "#ffe7a8", 1.1);
            flash(fx, t, k.x, 2, k.z, 12, KEY_COLOR, 0.9);
            break;
          }
        }
      }
    }
    let sc = k.reveal;
    let y = KEY_HOVER + Math.sin(t * 1.6 + i) * 0.12;
    if (k.found) {
      const f = Math.min(1, (t - k.foundAt) / 0.8);
      sc = (1 - f) * (1 + Math.sin(f * Math.PI) * 0.5);
      y += (1 - (1 - f) ** 2) * 2.4;
    }
    mesh.visible = showItems && sc > 0.01;
    mesh.position.set(k.x, y, k.z);
    mesh.rotation.set(0, t * (k.found ? 9 : 1.8) + i, 0.25);
    mesh.scale.setScalar(Math.max(1e-4, sc));
    if (glow) {
      glow.visible = mesh.visible && !k.found;
      // Unit-height-3 cylinder centred on its middle: lift it to stand on the ground.
      const h = 0.6 + sc * 1.6;
      glow.scale.set(0.5 + sc * 0.3, h, 0.5 + sc * 0.3);
      glow.position.set(k.x, 1.5 * h, k.z);
    }
  });
  keyBeamMat.uniforms.uTime.value = t;
  keyBeamMat.uniforms.uOpacity.value = 0.6;

  // ---- fireflies: the clue. A swarm hovers over every hidden key... and over
  // a few empty spots. They gather in tight once a key is lit. ----
  {
    const pos = wisps.geometry.attributes.position.array;
    const life = wisps.geometry.attributes.aLife.array;
    let n = 0;
    items.swarms.forEach((sw, si) => {
      const key = si < items.keys.length ? items.keys[si] : null;
      const gone = key?.found;
      const pull = key ? 1 - 0.65 * key.reveal : 1;
      for (const w of sw.wisps) {
        const a = w.ph + t * w.speed;
        const r = w.r * pull * (0.85 + 0.15 * Math.sin(t * 0.7 + w.ph * 2));
        pos[n * 3] = sw.at.x + Math.cos(a) * r;
        pos[n * 3 + 1] = w.h + Math.sin(t * 1.3 + w.ph) * 0.35;
        pos[n * 3 + 2] = sw.at.z + Math.sin(a) * r;
        const twinkle = 0.45 + 0.55 * Math.max(0, Math.sin(t * (2.2 + w.speed) + w.ph * 3));
        life[n] = gone || !showItems ? 0 : twinkle;
        n++;
      }
    });
    for (; n < life.length; n++) life[n] = 0;
    wisps.geometry.attributes.position.needsUpdate = true;
    wisps.geometry.attributes.aLife.needsUpdate = true;
    wisps.material.uniforms.uPixelRatio.value = state.viewport.dpr;
    if (wispsRef.current) wispsRef.current.visible = showItems && s.phase !== "unlocked";
  }

  // ---- key sense: each player's distance to the nearest hidden key ----
  chestFx.current.senseClock -= dt;
  if (chestFx.current.senseClock <= 0) {
    chestFx.current.senseClock = 0.25;
    for (let j = 0; j < players.length; j++) {
      let level = 0;
      if (s.phase === "hunt") {
        let d = Infinity;
        for (const k of items.keys) if (!k.found) d = Math.min(d, Math.hypot(players[j].position.x - k.x, players[j].position.z - k.z));
        const band = SENSE_DIST.findIndex((m) => d < m);
        level = band < 0 ? 0 : SENSE_LEVELS - 1 - band;
      }
      setKeySense(entries[j].id, level);
    }
  }

  // ---- chest: a lit landmark at the crossroads, locked until the keys are in ----
  const cf = chestFx.current;
  if (cf.round !== s.round) {
    cf.round = s.round; // a new round: the chest closes again
    cf.open = 0;
  }
  if (s.phase === "unlocked") {
    for (let j = 0; j < players.length; j++) {
      const p = players[j];
      if (Math.hypot(p.position.x - CHEST_POS.x, p.position.z - CHEST_POS.z) < CHEST_PICK) {
        openChest(entries[j]);
        cf.open = 1e-3;
        burst(sparks, _at.set(CHEST_POS.x, 1, CHEST_POS.z), 140, 3.4, 7.5);
        shockwave(fx, t, CHEST_POS.x, CHEST_POS.z, CHEST_COLOR, 2.5);
        shockwave(fx, t, CHEST_POS.x, CHEST_POS.z, GOLD_COLOR, 4, 0.2);
        shockwave(fx, t, CHEST_POS.x, CHEST_POS.z, KEY_COLOR, 6, 0.4);
        popup(fx, t, CHEST_POS.x, 2.8, CHEST_POS.z, "+10", "#ffb347", 1.6);
        flash(fx, t, CHEST_POS.x, 2.5, CHEST_POS.z, 22, CHEST_COLOR, 1.6);
        break;
      }
    }
  }
  if (cf.open > 0) {
    cf.open += dt;
    if (cf.open < 2.5 && Math.random() < dt * 20) burst(sparks, _at.set(CHEST_POS.x, 1, CHEST_POS.z), 6, 1.4, 6);
  }
  const ch = chestRef.current;
  if (ch) {
    const pop = cf.open > 0 ? Math.exp(-cf.open * 3) * Math.sin(cf.open * 18) * 0.12 : 0;
    const pulse = s.phase === "unlocked" ? Math.sin(t * 5) * 0.03 : 0;
    ch.scale.set(1 + pop + pulse, 1 - pop + pulse, 1 + pop + pulse);
    ch.material.emissiveIntensity = s.phase === "unlocked" ? 1.3 + Math.sin(t * 5) * 0.5 : cf.open > 0 ? 1.4 : 0.75 + Math.sin(t * 1.5) * 0.12;
  }
  const beamOn = s.phase === "unlocked" ? 1 : cf.open > 0 ? Math.max(0, 1 - cf.open / 4) : running || s.phase === "countdown" ? 0.22 : 0;
  chestBeamMat.uniforms.uOpacity.value = beamOn * 0.9;
  chestBeamMat.uniforms.uTime.value = t;
  if (chestBeam.current) chestBeam.current.visible = beamOn > 0.01;

  // Rune ring + one lamp per key: shows from afar how many keys are in.
  const deco = chestDeco.current;
  if (deco.ring) {
    const hot = s.phase === "unlocked";
    deco.ring.material.opacity = (hot ? 0.85 : 0.38) + Math.sin(t * (hot ? 6 : 1.6)) * 0.12;
    deco.ring.rotation.y = t * 0.15;
  }
  deco.orbs.forEach((orb, i) => {
    if (!orb) return;
    const lit = i < s.keysFound && s.phase !== "lobby";
    orb.material.color.set(lit ? "#ffe7a8" : "#3b4660");
    orb.scale.setScalar(lit ? 1 + Math.sin(t * 4 + i) * 0.15 : 0.8);
  });
  if (deco.light) deco.light.intensity = s.phase === "unlocked" ? 9 + Math.sin(t * 5) * 3 : 4;

  // ---- flourishes + sparkles ----
  stepFx(fx, t);
  sparks.material.uniforms.uPixelRatio.value = state.viewport.dpr;
  const anySparks = stepSparks(sparks, dt);
  if (sparksRef.current) sparksRef.current.visible = anySparks;
}

const ORB_ANGLES = Array.from({ length: KEYS_TOTAL }, (_, i) => (i / KEYS_TOTAL) * Math.PI * 2 + Math.PI / 2);

export default function Treasure() {
  const g = useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
  const coin = useModel(COIN_URL, { rotateX: Math.PI / 2, size: COIN_SIZE, emissive: "#8a5a00", emissiveIntensity: 0.9 });
  const key = useModel(KEY_URL, { rotateX: -Math.PI / 2, size: KEY_SIZE, by: "y", emissive: "#d09a30", emissiveIntensity: 1.5 });
  const chest = useModel(CHEST_URL, { size: CHEST_SIZE, by: "x", emissive: "#5a3608", emissiveIntensity: 0.75 });

  // New layout every round (and one up front for the lobby's empty world).
  const items = useMemo(() => makeRound(), [g.round]); // eslint-disable-line react-hooks/exhaustive-deps
  const showItems = g.phase === "hunt" || g.phase === "unlocked" || g.phase === "countdown";

  const coinsRef = useRef(null);
  const keyRefs = useRef([]);
  const keyGlowRefs = useRef([]);
  const chestRef = useRef(null);
  const chestBeam = useRef(null);
  const sparksRef = useRef(null);
  const wispsRef = useRef(null);
  const chestFx = useRef({ open: 0, round: -1, senseClock: 0 });
  const chestDeco = useRef({ ring: null, orbs: [], light: null });

  const sparks = useMemo(() => createSparks(), []);
  const wisps = useMemo(() => createWisps(), []);
  const fx = useMemo(() => createFx(), []);
  const chestBeamMat = useMemo(() => makeBeamMaterial("#ffd36e"), []);
  const keyBeamMat = useMemo(() => makeBeamMaterial("#ffe7a8"), []);
  useEffect(
    () => () => {
      sparks.geometry.dispose();
      sparks.material.dispose();
      wisps.geometry.dispose();
      wisps.material.dispose();
      disposeFx(fx);
      chestBeamMat.dispose();
      keyBeamMat.dispose();
    },
    [sparks, wisps, fx, chestBeamMat, keyBeamMat],
  );

  useFrame((state, dt) =>
    stepTreasure(state, dt, {
      items,
      sparks,
      wisps,
      keyBeamMat,
      chestBeamMat,
      coinsRef,
      keyRefs,
      keyGlowRefs,
      chestRef,
      chestBeam,
      sparksRef,
      wispsRef,
      chestFx,
      fx,
      chestDeco,
      showItems,
    }),
  );

  return (
    <>
      <instancedMesh ref={coinsRef} args={[coin.geometry, coin.material, COIN_COUNT]} frustumCulled={false} />
      {Array.from({ length: KEYS_TOTAL }, (_, i) => (
        <group key={i}>
          <mesh
            ref={(el) => {
              keyRefs.current[i] = el;
            }}
            geometry={key.geometry}
            material={key.material}
            visible={false}
          />
          <mesh
            ref={(el) => {
              keyGlowRefs.current[i] = el;
            }}
            material={keyBeamMat}
            visible={false}
            renderOrder={5}
          >
            <cylinderGeometry args={[0.6, 0.9, 3, 24, 1, true]} />
          </mesh>
        </group>
      ))}

      <mesh ref={chestRef} geometry={chest.geometry} material={chest.material} position={CHEST_POS} rotation={[0, 0, 0]} />
      <group position={CHEST_POS}>
        <mesh
          ref={(el) => {
            chestDeco.current.ring = el;
          }}
          position={[0, 0.05, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={4}
        >
          <ringGeometry args={[2.05, 2.35, 64]} />
          <meshBasicMaterial color="#ffc76a" transparent opacity={0.4} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
        </mesh>
        {ORB_ANGLES.map((a, i) => (
          <mesh
            key={i}
            ref={(el) => {
              chestDeco.current.orbs[i] = el;
            }}
            position={[Math.cos(a) * 2.2, 0.35, Math.sin(a) * 2.2]}
          >
            <sphereGeometry args={[0.16, 16, 12]} />
            <meshBasicMaterial color="#3b4660" toneMapped={false} />
          </mesh>
        ))}
        <pointLight
          ref={(el) => {
            chestDeco.current.light = el;
          }}
          position={[0, 2.4, 0]}
          color="#ffc76a"
          intensity={4}
          distance={9}
          decay={1.6}
        />
      </group>
      <mesh ref={chestBeam} material={chestBeamMat} position={[CHEST_POS.x, 6, CHEST_POS.z]} visible={false} renderOrder={5}>
        <cylinderGeometry args={[0.9, 1.3, 12, 32, 1, true]} />
      </mesh>

      <points ref={wispsRef} geometry={wisps.geometry} material={wisps.material} frustumCulled={false} visible={false} />
      <points ref={sparksRef} geometry={sparks.geometry} material={sparks.material} frustumCulled={false} visible={false} />
      <primitive object={fx.group} />
    </>
  );
}
