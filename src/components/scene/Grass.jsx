"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
} from "three";
import {
  FIELD_RADIUS,
  FOG_FAR,
  FOG_NEAR,
  GRASS_RADIUS,
  HEMI_INTENSITY,
  MAX_BLADES,
  PALETTE,
  SUN_INTENSITY,
  SUN_POSITION,
  isOnRoad,
} from "./config";
import { fbm, mulberry32 } from "./utils";

/**
 * Instanced grass: ONE draw call for every blade.
 * - Blade shape is a tapered strip (9 verts). All per-blade data lives in two
 *   instanced attributes, and all motion (wind) happens on the GPU.
 * - Blades are generated once at MAX_BLADES in random order; quality tiers
 *   simply change `instanceCount`, so switching tiers costs nothing.
 */

const SEGMENTS = 3; // 7 verts per blade

function createBladeGeometry() {
  const positions = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const y = i / SEGMENTS;
    const w = 1 - Math.pow(y, 1.4);
    positions.push(-0.5 * w, y, 0, 0.5 * w, y, 0);
  }
  positions.push(0, 1, 0); // tip

  const indices = [];
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const last = (SEGMENTS - 1) * 2;
  indices.push(last, last + 1, SEGMENTS * 2);

  const geo = new InstancedBufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  return geo;
}

function createBladeInstances(count) {
  const rand = mulberry32(42);
  const offsets = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    // Uniform random point in the disc (random order lets quality tiers use
    // any prefix of the list and still cover the whole field evenly).
    // Rejection-sample so no blades grow through the brick roads.
    let r = 0;
    let x = 0;
    let z = 0;
    do {
      const a = rand() * Math.PI * 2;
      r = Math.sqrt(rand()) * GRASS_RADIUS;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    } while (isOnRoad(x, z));

    const clump = fbm(x * 0.11 + 3.1, z * 0.11 - 7.3); // tufts / uneven growth
    const edge = Math.min(1, (GRASS_RADIUS - r) / 1.5); // a little shorter by the wall
    const height = (0.16 + clump * 0.24) * (0.7 + rand() * 0.6) * (0.6 + 0.4 * edge);

    offsets[i * 3] = x;
    offsets[i * 3 + 1] = 0;
    offsets[i * 3 + 2] = z;
    params[i * 4] = rand() * Math.PI * 2; // yaw
    params[i * 4 + 1] = height;
    params[i * 4 + 2] = 0.035 + rand() * 0.03; // width (thin blades)
    params[i * 4 + 3] = rand(); // random seed
  }
  return { offsets, params };
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uFieldRadius;
  uniform vec2  uWindDir;
  uniform float uWindStrength;
  uniform sampler2D uGroundMap;

  attribute vec3 aOffset;
  attribute vec4 aParams; // yaw, height, width, rand

  varying vec3  vBaseColor;
  varying vec3  vNormal;
  varying vec3  vWorldPos;
  varying float vH;
  varying float vRand;

  void main() {
    float h      = position.y;
    float yaw    = aParams.x;
    float height = aParams.y;
    float width  = aParams.z;
    float rnd    = aParams.w;

    vec3 p = vec3(position.x * width, h * height, 0.0);

    // Natural curl: blades lean forward more towards the tip.
    float lean = 0.2 + rnd * 0.5;
    p.z += lean * h * h * height;
    p.y -= lean * 0.2 * h * h * height;

    float c = cos(yaw), s = sin(yaw);
    mat2 rot = mat2(c, -s, s, c);
    p.xz = rot * p.xz;
    vec3 n = vec3(0.0, 0.0, 1.0);
    n.xz = rot * n.xz;

    // Wind: slow rolling gusts travelling across the field + small flutter.
    vec2  wp     = aOffset.xz;
    float along  = dot(wp, uWindDir);
    float gust   = sin(along * 0.11 - uTime * 1.05) * 0.5 + 0.5;
    gust = gust * gust * gust;
    float flutter = sin(uTime * 2.1 + rnd * 6.2831 + along * 0.55) * 0.3
                  + sin(uTime * 3.6 + wp.x * 1.3 + wp.y * 0.7) * 0.12;
    float bend = (0.25 + gust * 1.1 + flutter) * uWindStrength;
    vec2 sway = uWindDir * bend * h * h * height;
    p.xz += sway;
    p.y  -= dot(sway, sway) * 0.6 / max(height, 0.02) * h; // keep blade length ~constant

    vec3 world = aOffset + p;
    vWorldPos = world;
    vH = h;
    vRand = rnd;

    // Blades take their colour from the ground texture beneath them, so the
    // dry/lush patches carry up into the grass.
    vec2 guv = vec2(aOffset.x / uFieldRadius * 0.5 + 0.5,
                    1.0 - (aOffset.z / uFieldRadius * 0.5 + 0.5));
    vBaseColor = textureLod(uGroundMap, guv, 1.5).rgb;

    // Rounded normal: mostly up-facing so the turf shades softly like a lawn.
    vNormal = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.78));

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform vec3  uHemiSky;
  uniform vec3  uHemiGround;
  uniform float uHemiIntensity;
  uniform vec3  uTipColor;
  uniform vec3  uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec3  vBaseColor;
  varying vec3  vNormal;
  varying vec3  vWorldPos;
  varying float vH;
  varying float vRand;

  void main() {
    vec3 base   = vBaseColor * (0.95 + vRand * 0.35);
    vec3 tip    = mix(base * 1.35, uTipColor, 0.2 + vRand * 0.35);
    vec3 albedo = mix(base, tip, smoothstep(0.3, 1.0, vH));

    // Fake ambient occlusion: blade roots sit in the shade of the turf.
    float ao = mix(0.55, 1.0, smoothstep(0.0, 0.7, vH));

    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n.xz = -n.xz;

    float ndl   = max(dot(n, uSunDir), 0.0);
    vec3  hemi  = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * uHemiIntensity;
    vec3  sun   = uSunColor * uSunIntensity * ndl;

    // Translucency: blades glow warm when the low sun is behind them.
    vec3  viewDir = normalize(cameraPosition - vWorldPos);
    float back    = pow(max(dot(-viewDir, uSunDir), 0.0), 3.0) * vH;
    vec3  trans   = uSunColor * uSunIntensity * back * 0.55;

    // Same 1/PI Lambert convention as three.js lights -> matches the ground.
    vec3 col = albedo * ((hemi + sun) * ao + trans) * RECIPROCAL_PI;

    float fogF = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorldPos));
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Per-frame GPU wind clock. Kept outside the component: three.js objects are
// mutable by design, React state is not involved.
function setInstanceCount(mesh, count) {
  if (mesh) mesh.geometry.instanceCount = count;
}

function advanceWind(mesh, delta) {
  if (mesh) mesh.material.uniforms.uTime.value += Math.min(delta, 0.1);
}

export default function Grass({ groundMap, count }) {
  const meshRef = useRef(null);

  const geometry = useMemo(() => {
    const geo = createBladeGeometry();
    const { offsets, params } = createBladeInstances(MAX_BLADES);
    geo.setAttribute("aOffset", new InstancedBufferAttribute(offsets, 3));
    geo.setAttribute("aParams", new InstancedBufferAttribute(params, 4));
    geo.boundingSphere = new Sphere(new Vector3(0, 0, 0), FIELD_RADIUS + 1);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uFieldRadius: { value: FIELD_RADIUS },
          uWindDir: { value: new Vector2(0.8, 0.6).normalize() },
          uWindStrength: { value: 0.32 },
          uGroundMap: { value: groundMap },
          uSunDir: { value: new Vector3(...SUN_POSITION).normalize() },
          uSunColor: { value: new Color(PALETTE.sun) },
          uSunIntensity: { value: SUN_INTENSITY },
          uHemiSky: { value: new Color(PALETTE.hemiSky) },
          uHemiGround: { value: new Color(PALETTE.hemiGround) },
          uHemiIntensity: { value: HEMI_INTENSITY },
          uTipColor: { value: new Color(PALETTE.grassTip) },
          uFogColor: { value: new Color(PALETTE.fog) },
          uFogNear: { value: FOG_NEAR },
          uFogFar: { value: FOG_FAR },
        },
      }),
    [groundMap],
  );

  // Quality tier changes only alter how many instances are drawn.
  useLayoutEffect(() => setInstanceCount(meshRef.current, count), [count]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => advanceWind(meshRef.current, delta));

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}
