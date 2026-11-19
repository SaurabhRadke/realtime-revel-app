"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector3,
} from "three";
import { MOON_POSITION, PALETTE } from "./config";
import SCENE_MODELS from "./sceneModels.json";

// Everything here moves with the camera, so the sky behaves as if it were
// infinitely far away (no parallax when you walk).

const MOON_URL = SCENE_MODELS.find((m) => m.kind === "moon")?.url;
if (MOON_URL) useGLTF.preload(MOON_URL, false);

const MOON_DIR = new Vector3(...MOON_POSITION).normalize();
const MOON_DISTANCE = 450;
const MOON_SIZE = 15; // ~1.9 deg across: larger than life, as the eye sees it near the horizon
const STAR_RADIUS = 520;
const DOME_RADIUS = 600;

// The Milky Way: a faint band across the sky along this great circle.
const BAND_NORMAL = new Vector3(0.45, 0.35, 0.82).normalize();

// ---- Sky dome: night gradient, Milky Way haze, moon halo ----

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop, uHorizon, uFog, uMoon, uMoonDir, uBandNormal;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);

    // Deep blue-black overhead, a little lighter and bluer near the horizon.
    vec3 col = mix(uHorizon, uTop, pow(up, 0.35));

    // Milky Way: a soft, clumpy band with dark dust lanes down its middle.
    float b = dot(d, uBandNormal);
    float band = exp(-b * b * 28.0);
    float clouds = fbm(d * 6.0);
    float dust = smoothstep(0.45, 0.75, fbm(d * 11.0 + 7.0)) * exp(-b * b * 160.0);
    float mw = band * (0.35 + clouds * 0.9) * (1.0 - dust * 0.7);
    col += vec3(0.62, 0.66, 0.78) * mw * 0.055 * smoothstep(0.0, 0.35, d.y);

    // Moonlit haze around the moon.
    float m = max(dot(d, uMoonDir), 0.0);
    col += uMoon * (pow(m, 90.0) * 0.22 + pow(m, 12.0) * 0.06 + pow(m, 3.0) * 0.02);

    // Below the horizon blend into the fog so the ground's edge disappears.
    col = mix(uFog, col, smoothstep(-0.03, 0.08, d.y));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function SkyDome() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(PALETTE.skyTop) },
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uFog: { value: new Color(PALETTE.fog) },
          uMoon: { value: new Color(PALETTE.moon) },
          uMoonDir: { value: MOON_DIR },
          uBandNormal: { value: BAND_NORMAL },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh material={material} renderOrder={-2} frustumCulled={false}>
      <sphereGeometry args={[DOME_RADIUS, 48, 24]} />
    </mesh>
  );
}

// ---- Stars ----

// Rough star colours by temperature: blue-white, white, yellow, orange.
const STAR_TINTS = [
  [0.75, 0.83, 1.0],
  [0.92, 0.95, 1.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.94, 0.82],
  [1.0, 0.82, 0.62],
];

function randomStarDir(rng, inBand) {
  const v = new Vector3();
  for (;;) {
    v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    const l = v.length();
    if (l < 0.05 || l > 1) continue;
    v.divideScalar(l);
    if (v.y < -0.05) continue; // nothing below the horizon
    // Extra faint stars crowd along the Milky Way.
    if (inBand && Math.abs(v.dot(BAND_NORMAL)) > 0.12 + rng() * 0.12) continue;
    return v;
  }
}

function createStars(count, bandCount) {
  const rng = Math.random;
  const pos = [];
  const size = [];
  const color = [];
  const phase = [];
  for (let i = 0; i < count + bandCount; i++) {
    const inBand = i >= count;
    const d = randomStarDir(rng, inBand);
    pos.push(d.x * STAR_RADIUS, d.y * STAR_RADIUS, d.z * STAR_RADIUS);
    // Many faint stars, few bright ones (roughly like real magnitudes).
    const mag = Math.pow(rng(), inBand ? 9 : 5.5);
    size.push(0.9 + mag * 3.4);
    const tint = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)];
    const bright = (inBand ? 0.35 : 0.45) + mag * 1.6;
    color.push(tint[0] * bright, tint[1] * bright, tint[2] * bright);
    phase.push(rng() * Math.PI * 2, 0.6 + rng() * 2.2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new Float32BufferAttribute(size, 1));
  geo.setAttribute("aColor", new Float32BufferAttribute(color, 3));
  geo.setAttribute("aTwinkle", new Float32BufferAttribute(phase, 2));
  return geo;
}

const starVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute vec3 aColor;
  attribute vec2 aTwinkle; // phase, speed
  varying vec3 vColor;
  void main() {
    vec3 dir = normalize(position);
    // Stars near the horizon are dimmer (more air) and twinkle harder.
    float alt = clamp(dir.y, 0.0, 1.0);
    float extinction = smoothstep(0.0, 0.25, alt);
    float tw = sin(uTime * aTwinkle.y + aTwinkle.x) * 0.5 + 0.5;
    float twinkle = 1.0 - (0.15 + 0.35 * (1.0 - alt)) * tw * tw;
    vColor = aColor * extinction * twinkle;
    gl_PointSize = aSize * uPixelRatio * mix(0.7, 1.0, extinction);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r));
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Per-frame twinkle clock, mutated through the mesh (three.js objects are
// mutable by design; React state is not involved).
function advanceStars(points, dt, dpr) {
  if (!points) return;
  points.material.uniforms.uTime.value += Math.min(dt, 0.1);
  points.material.uniforms.uPixelRatio.value = dpr;
}

function Stars() {
  const ref = useRef(null);
  const dpr = useThree((s) => s.viewport.dpr);
  const geometry = useMemo(() => createStars(4200, 2600), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
        vertexShader: starVertex,
        fragmentShader: starFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((_, dt) => advanceStars(ref.current, dt, dpr));

  return <points ref={ref} geometry={geometry} material={material} renderOrder={-1} frustumCulled={false} />;
}

// ---- Moon ----

function Moon() {
  const { scene } = useGLTF(MOON_URL, false);
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      // Unlit and bright: the full moon glows evenly, it isn't shaded by our lights.
      o.material = new MeshBasicMaterial({
        map: o.material.map,
        color: new Color(1.55, 1.55, 1.45),
        fog: false,
      });
    });
    return root;
  }, [scene]);
  useEffect(
    () => () =>
      model.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      }),
    [model],
  );

  const p = MOON_DIR.clone().multiplyScalar(MOON_DISTANCE);
  return (
    <primitive
      object={model}
      position={[p.x, p.y, p.z]}
      rotation={[0.25, -0.9, 0.1]}
      scale={MOON_SIZE}
    />
  );
}

export default function NightSky() {
  const group = useRef(null);
  useFrame(({ camera }) => group.current?.position.copy(camera.position));

  return (
    <group ref={group}>
      <SkyDome />
      <Stars />
      {MOON_URL && <Moon />}
    </group>
  );
}
