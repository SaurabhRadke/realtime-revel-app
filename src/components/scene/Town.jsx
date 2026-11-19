"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Vector3,
} from "three";
import { PALETTE } from "./config";
import {
  LAMP_LIT,
  LANTERN_HEIGHT_FRACTION,
  LANTERN_OFFSET_X,
  createLampLightMap,
  lampUniforms,
  makeLampLit,
} from "./lampLight";
import { LAMP_URL, getTownLayout, getTownModelUrls } from "./townLayout";
import { MUD_TILE_METRES, createEdgeMask, createMudTextures } from "./roadTextures";

// ---- Mud path: a ribbon following the path's centre line ----

function createPathGeometry({ points, width }) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const uvTile = new Float32Array(n * 2 * 2); // mud texture, tiles in metres
  const uvMask = new Float32Array(n * 2 * 2); // ragged edge mask, 0..1 over the path
  const index = [];
  let along = 0;

  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    const [ax, az] = points[Math.max(0, i - 1)];
    const [bx, bz] = points[Math.min(n - 1, i + 1)];
    if (i > 0) along += Math.hypot(x - ax, z - az);
    let tx = bx - ax;
    let tz = bz - az;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Slightly wider where the path meets the road, worn by turning carts.
    const t = i / (n - 1);
    const half = (width / 2) * (1 + Math.pow(t, 6) * 0.6);
    const nx = -tz * half;
    const nz = tx * half;

    pos.set([x - nx, 0, z - nz, x + nx, 0, z + nz], i * 6);
    uvTile.set([-half / MUD_TILE_METRES, along / MUD_TILE_METRES, half / MUD_TILE_METRES, along / MUD_TILE_METRES], i * 4);
    uvMask.set([0, t, 1, t], i * 4);
    if (i < n - 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(n * 2 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute("uv", new BufferAttribute(uvTile, 2));
  geo.setAttribute("uv1", new BufferAttribute(uvMask, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

function MudPath({ path, mud, seed }) {
  const geometry = useMemo(() => createPathGeometry(path), [path]);
  const mask = useMemo(() => {
    const m = createEdgeMask({ seed, ragged: 0.32, bites: 0.12, length: 512, width: 64 });
    m.channel = 1; // read the 0..1 mask UVs, not the tiling mud UVs
    return m;
  }, [seed]);
  useEffect(
    () => () => {
      geometry.dispose();
      mask.dispose();
    },
    [geometry, mask],
  );

  return (
    // Just above the bare ground, below the road layers it runs into.
    <mesh geometry={geometry} position={[0, 0.006, 0]}>
      <meshLambertMaterial
        map={mud.map}
        bumpMap={mud.bumpMap}
        bumpScale={1.4}
        color="#d8c8b0"
        alphaMap={mask}
        alphaTest={0.5}
        polygonOffset
        polygonOffsetFactor={-0.5}
        polygonOffsetUnits={-0.5}
        {...LAMP_LIT}
      />
    </mesh>
  );
}

// ---- Soft contact shadow so the houses sit in the ground ----

function createShadowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  // Draw the rect off-canvas and keep only its blurred shadow (works in every
  // browser, unlike ctx.filter).
  ctx.shadowColor = "rgba(30, 22, 10, 0.75)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = size * 2;
  ctx.fillRect(size * 0.22 - size * 2, size * 0.22, size * 0.56, size * 0.56);
  return new CanvasTexture(c);
}

// Start downloading every model the town needs as soon as this module loads
// (all in parallel). The scene waits for all of them before it first shows.
for (const url of getTownModelUrls()) useGLTF.preload(url, false);

// ---- Street lamp light ----

// World position of each lamp's lantern (the glass box at the top of the post).
const LANTERNS = getTownLayout().lamps.map((l) => {
  const off = LANTERN_OFFSET_X * l.scale; // model units -> metres
  return {
    x: l.x + Math.cos(l.yaw) * off,
    z: l.z - Math.sin(l.yaw) * off,
    y: l.height * LANTERN_HEIGHT_FRACTION,
  };
});
lampUniforms.uLampMap.value = createLampLightMap(LANTERNS);

function glowTexture(stops) {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

// Glowing lanterns: a hot core and a wide soft halo, one draw call each.
function LanternGlow() {
  const res = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(LANTERNS.flatMap((p) => [p.x, p.y, p.z]), 3));
    const core = glowTexture([
      [0, "rgba(255,246,225,1)"],
      [0.25, "rgba(255,214,150,0.85)"],
      [0.6, "rgba(255,160,70,0.25)"],
      [1, "rgba(255,140,50,0)"],
    ]);
    const halo = glowTexture([
      [0, "rgba(255,190,110,0.55)"],
      [0.3, "rgba(255,160,80,0.18)"],
      [1, "rgba(255,140,60,0)"],
    ]);
    return { geo, core, halo };
  }, []);
  const coreMat = useRef(null);
  const haloMat = useRef(null);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.core.dispose();
      res.halo.dispose();
    },
    [res],
  );
  useFrame(() => {
    const k = lampUniforms.uLampStrength.value;
    if (coreMat.current) coreMat.current.opacity = k;
    if (haloMat.current) haloMat.current.opacity = k * 0.8;
  });

  const common = { transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false };
  return (
    <group>
      <points geometry={res.geo} frustumCulled={false}>
        <pointsMaterial ref={haloMat} map={res.halo} size={5} color={PALETTE.lamp} {...common} />
      </points>
      <points geometry={res.geo} frustumCulled={false}>
        <pointsMaterial ref={coreMat} map={res.core} size={0.9} {...common} />
      </points>
    </group>
  );
}

// Eases the lamps on/off; switching on, the gas mantles sputter briefly.
function LampSwitch({ on }) {
  const since = useRef(0);
  const wasOn = useRef(on);
  useFrame((_, dt) => {
    if (on !== wasOn.current) {
      wasOn.current = on;
      since.current = 0;
    }
    since.current += dt;
    const u = lampUniforms.uLampStrength;
    if (!on) {
      u.value = Math.max(0, u.value - dt * 4); // quick fade to black
      return;
    }
    const t = since.current;
    const flicker = t < 0.7 ? (Math.random() < 0.35 ? 0.25 : 1) * Math.min(1, t * 2.5) : 1;
    u.value += (flicker - u.value) * Math.min(1, dt * (t < 0.7 ? 30 : 6));
  });
  return null;
}

// ---- A placed model (house or lamp) ----

function Model({ url, scale }) {
  const { scene } = useGLTF(url, false);

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        // Weathered wood/stone/thatch, not metal: without an environment map
        // metallic areas would render nearly black.
        m.metalness = 0;
        if ("specularIntensity" in m) m.specularIntensity = 0.4;
        makeLampLit(m); // picks up the street lamps' warm light
      }
    });
    // Centre the footprint on the origin and stand it on the ground.
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const c = box.getCenter(new Vector3());
    root.position.set(-c.x, -box.min.y - 0.05, -c.z); // sunk a touch into the soil
    return root;
  }, [scene, scale]);

  return <primitive object={model} />;
}

function House({ house, mud, shadow }) {
  return (
    <group>
      <MudPath path={house.path} mud={mud} seed={house.path.seed} />
      <group position={[house.x, 0, house.z]} rotation={[0, house.yaw, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} renderOrder={1}>
          <planeGeometry args={[house.halfWidth * 2 * 1.45, house.halfDepth * 2 * 1.45]} />
          <meshBasicMaterial map={shadow} transparent depthWrite={false} fog />
        </mesh>
        <Model url={house.url} scale={house.scale} />
      </group>
    </group>
  );
}

function Lamp({ lamp }) {
  return (
    <group position={[lamp.x, 0, lamp.z]} rotation={[0, lamp.yaw, 0]}>
      <Model url={LAMP_URL} scale={lamp.scale} />
    </group>
  );
}

// Suspends until every model has loaded, so the whole town appears at once.
export default function Town({ lampsOn = true }) {
  const { houses, lamps } = getTownLayout();
  const res = useMemo(() => {
    const mud = createMudTextures(512);
    return { mud, shadow: createShadowTexture() };
  }, []);
  useEffect(
    () => () => {
      res.mud.map.dispose();
      res.mud.bumpMap.dispose();
      res.shadow.dispose();
    },
    [res],
  );

  return (
    <group>
      {houses.map((h, i) => (
        <House key={`h${i}`} house={h} mud={res.mud} shadow={res.shadow} />
      ))}
      {lamps.map((l, i) => (
        <Lamp key={`l${i}`} lamp={l} />
      ))}
      <LanternGlow />
      <LampSwitch on={lampsOn} />
    </group>
  );
}
