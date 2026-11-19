"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Matrix4,
  Object3D,
  ShaderMaterial,
  Vector3,
} from "three";
import SCENE_MODELS from "./sceneModels.json";
import { FIELD_RADIUS, MUD_VERGE, ROAD_WIDTH } from "./config";
import { getPlayerState } from "./player";
import { getPlayers } from "./roster";
import { COIN_COUNT, KEYS_TOTAL, collectCoin, collectKey, game, getGame, openChest, tickGame } from "./game";
import { TORCH } from "./torchLight";
import { isInsideHouse } from "./townLayout";

const url = (kind) => SCENE_MODELS.find((m) => m.kind === kind)?.url;
const COIN_URL = url("coin");
const KEY_URL = url("key");
const CHEST_URL = url("chest");
for (const u of [COIN_URL, KEY_URL, CHEST_URL]) if (u) useGLTF.preload(u, false);

// ---- Tuning ----
const COIN_SIZE = 0.5; // metres across
const KEY_SIZE = 0.75; // metres tall
const CHEST_SIZE = 1.5; // metres wide
const CHEST_POS = new Vector3(0, 0, 0); // the crossroads
const COIN_PICK = 1.0; // pickup radius, metres
const KEY_PICK = 1.3;
const CHEST_PICK = 2.0;
const REVEAL_NEAR = 3.2; // a key shows itself to anyone this close...
const REVEAL_BEAM = 20; // ...or to a torch beam within this range
const REVEAL_CONE = Math.cos(TORCH.angle * 1.25);
const REVEAL_HOLD = 3.5; // seconds a key stays visible after the light leaves it
const ROAD_OUTER = ROAD_WIDTH / 2 + MUD_VERGE;

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
  ).map((p, i) => ({ ...p, taken: false, takenAt: 0, phase: i * 0.7 }));

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
    if (spot) keys.push({ ...spot, found: false, foundAt: 0, reveal: 0, litAt: -1e9 });
  }
  return { coins, keys };
}

// ---------------------------------------------------------------------------
// Sparkle bursts (pickups, chest opening): one small CPU particle pool.
// ---------------------------------------------------------------------------
const SPARKS = 220;
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

function createSparks() {
  const g = new BufferGeometry();
  const pos = new BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(DynamicDrawUsage);
  const life = new BufferAttribute(new Float32Array(SPARKS), 1).setUsage(DynamicDrawUsage);
  const size = new BufferAttribute(new Float32Array(SPARKS), 1);
  for (let i = 0; i < SPARKS; i++) size.array[i] = rand(3, 8);
  g.setAttribute("position", pos);
  g.setAttribute("aLife", life);
  g.setAttribute("aSize", size);
  const m = new ShaderMaterial({
    uniforms: { uColor: { value: new Color("#ffcf5a") }, uPixelRatio: { value: 1 } },
    vertexShader: sparkVertex,
    fragmentShader: sparkFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const vel = new Float32Array(SPARKS * 3);
  return { geometry: g, material: m, vel, next: 0 };
}

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
  const { items, sparks, keyBeamMat, chestBeamMat, coinsRef, keyRefs, keyGlowRefs, chestRef, chestBeam, sparksRef, chestFx, showItems } = c;
  const dt = Math.min(rawDt, 0.1);
  const t = state.clock.elapsedTime;
  tickGame();
  const s = getGame();
  const running = s.phase === "hunt" || s.phase === "unlocked";
  const entries = getPlayers();
  const players = entries.map((e) => getPlayerState(e.id, e.slot));

  // ---- coins ----
  const cm = coinsRef.current;
  if (cm) {
    items.coins.forEach((c, i) => {
      let y = 0.55 + Math.sin(t * 2 + c.phase) * 0.08;
      let sc = 1;
      if (c.taken) {
        const k = Math.min(1, (performance.now() - c.takenAt) / 350);
        y += k * 1.4;
        sc = 1 - k;
      } else if (running) {
        for (let j = 0; j < players.length; j++) {
          const p = players[j];
          if (Math.hypot(p.position.x - c.x, p.position.z - c.z) < COIN_PICK) {
            c.taken = true;
            c.takenAt = performance.now();
            collectCoin(entries[j].id);
            burst(sparks, _at.set(c.x, y, c.z), 10, 1.6, 2.5);
            break;
          }
        }
      }
      _o.position.set(c.x, y, c.z);
      _o.rotation.set(0, t * 2.4 + c.phase, 0);
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
      if (s.phase === "hunt" && k.reveal > 0.35) {
        for (let j = 0; j < players.length; j++) {
          const p = players[j];
          if (Math.hypot(p.position.x - k.x, p.position.z - k.z) < KEY_PICK) {
            k.found = true;
            k.foundAt = t;
            collectKey(entries[j]);
            burst(sparks, _at.set(k.x, 0.9, k.z), 40, 2.4, 4);
            break;
          }
        }
      }
    }
    let sc = k.reveal;
    let y = 0.35 + Math.sin(t * 1.6 + i) * 0.1;
    if (k.found) {
      const f = Math.min(1, (t - k.foundAt) / 0.6);
      sc = 1 - f;
      y += f * 2;
    }
    mesh.visible = showItems && sc > 0.01;
    mesh.position.set(k.x, y, k.z);
    mesh.rotation.set(0, t * 1.8 + i, 0.25);
    mesh.scale.setScalar(Math.max(1e-4, sc));
    if (glow) {
      glow.visible = mesh.visible && !k.found;
      // Unit-height-3 cylinder centred on its middle: lift it to stand on the ground.
      glow.scale.set(0.5 + sc * 0.3, 0.6 + sc, 0.5 + sc * 0.3);
      glow.position.set(k.x, 1.5 * (0.6 + sc), k.z);
    }
  });
  keyBeamMat.uniforms.uTime.value = t;
  keyBeamMat.uniforms.uOpacity.value = 0.55;

  // ---- chest: locked at the crossroads until the keys are in ----
  const fx = chestFx.current;
  if (fx.round !== s.round) {
    fx.round = s.round; // a new round: the chest closes again
    fx.open = 0;
  }
  if (s.phase === "unlocked") {
    for (let j = 0; j < players.length; j++) {
      const p = players[j];
      if (Math.hypot(p.position.x - CHEST_POS.x, p.position.z - CHEST_POS.z) < CHEST_PICK) {
        openChest(entries[j]);
        fx.open = 1e-3;
        burst(sparks, _at.set(CHEST_POS.x, 1, CHEST_POS.z), 120, 3.2, 7);
        break;
      }
    }
  }
  if (fx.open > 0) {
    fx.open += dt;
    if (fx.open < 2.5 && Math.random() < dt * 20) burst(sparks, _at.set(CHEST_POS.x, 1, CHEST_POS.z), 6, 1.4, 6);
  }
  const ch = chestRef.current;
  if (ch) {
    const pop = fx.open > 0 ? Math.exp(-fx.open * 3) * Math.sin(fx.open * 18) * 0.12 : 0;
    const pulse = s.phase === "unlocked" ? Math.sin(t * 5) * 0.03 : 0;
    ch.scale.set(1 + pop + pulse, 1 - pop + pulse, 1 + pop + pulse);
    ch.material.emissiveIntensity = s.phase === "unlocked" ? 1.2 + Math.sin(t * 5) * 0.5 : fx.open > 0 ? 1.4 : 0.4;
  }
  const beamOn = s.phase === "unlocked" ? 1 : fx.open > 0 ? Math.max(0, 1 - fx.open / 4) : 0;
  chestBeamMat.uniforms.uOpacity.value = beamOn * 0.9;
  chestBeamMat.uniforms.uTime.value = t;
  if (chestBeam.current) chestBeam.current.visible = beamOn > 0.01;

  // ---- sparkles ----
  sparks.material.uniforms.uPixelRatio.value = state.viewport.dpr;
  const anySparks = stepSparks(sparks, dt);
  if (sparksRef.current) sparksRef.current.visible = anySparks;
}

export default function Treasure() {
  const g = useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
  const coin = useModel(COIN_URL, { rotateX: Math.PI / 2, size: COIN_SIZE, emissive: "#8a5a00", emissiveIntensity: 0.9 });
  const key = useModel(KEY_URL, { rotateX: -Math.PI / 2, size: KEY_SIZE, by: "y", emissive: "#b8862a", emissiveIntensity: 1.2 });
  const chest = useModel(CHEST_URL, { size: CHEST_SIZE, by: "x", emissive: "#3a2306", emissiveIntensity: 0.4 });

  // New layout every round (and one up front for the lobby's empty world).
  const items = useMemo(() => makeRound(), [g.round]); // eslint-disable-line react-hooks/exhaustive-deps
  const showItems = g.phase === "hunt" || g.phase === "unlocked" || g.phase === "countdown";

  const coinsRef = useRef(null);
  const keyRefs = useRef([]);
  const keyGlowRefs = useRef([]);
  const chestRef = useRef(null);
  const chestBeam = useRef(null);
  const sparksRef = useRef(null);
  const chestFx = useRef({ open: 0, round: -1 });

  const sparks = useMemo(() => createSparks(), []);
  const chestBeamMat = useMemo(() => makeBeamMaterial("#ffd36e"), []);
  const keyBeamMat = useMemo(() => makeBeamMaterial("#ffe7a8"), []);
  useEffect(
    () => () => {
      sparks.geometry.dispose();
      sparks.material.dispose();
      chestBeamMat.dispose();
      keyBeamMat.dispose();
    },
    [sparks, chestBeamMat, keyBeamMat],
  );

  useFrame((state, dt) =>
    stepTreasure(state, dt, {
      items,
      sparks,
      keyBeamMat,
      chestBeamMat,
      coinsRef,
      keyRefs,
      keyGlowRefs,
      chestRef,
      chestBeam,
      sparksRef,
      chestFx,
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
      <mesh ref={chestBeam} material={chestBeamMat} position={[CHEST_POS.x, 6, CHEST_POS.z]} visible={false} renderOrder={5}>
        <cylinderGeometry args={[0.9, 1.3, 12, 32, 1, true]} />
      </mesh>
      <points ref={sparksRef} geometry={sparks.geometry} material={sparks.material} frustumCulled={false} visible={false} />
    </>
  );
}
