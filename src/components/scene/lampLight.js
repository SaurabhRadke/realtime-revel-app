// Warm light from the street lamps, without a single real-time light.
//
// Twenty-odd point lights would be far too slow over 650k grass blades, so the
// lamps' light is painted once into a "light map": a top-down texture of the
// field holding a soft warm pool under every lantern. Every surface (grass,
// ground, roads, paths, houses, lamp posts) adds that texture's colour at its
// own world position, scaled by one shared strength uniform. Turning the lamps
// off is just animating that uniform to 0.

import { CanvasTexture, Color, LinearFilter, SRGBColorSpace } from "three";
import { FIELD_RADIUS, PALETTE } from "./config";

const MAP_SIZE = 1024; // ~8 cm per texel over the 84 m field
const POOL_RADIUS = 11; // metres the light reaches on the ground
export const LANTERN_HEIGHT_FRACTION = 0.85; // lantern box sits this high up the post
export const LANTERN_OFFSET_X = -0.05; // and this far off-centre, in model units

// Shared by every lit material, so one assignment switches the whole town.
export const lampUniforms = {
  uLampMap: { value: null },
  uLampStrength: { value: 0 }, // 0 = off .. 1 = fully on
  uLampColor: { value: new Color(PALETTE.lamp) },
  uLampField: { value: FIELD_RADIUS },
  uLampTop: { value: 4.2 }, // light fades out above lantern height
};

/** Paints the light pools for `points` ({x, z} lantern positions). */
export function createLampLightMap(points) {
  const c = document.createElement("canvas");
  c.width = c.height = MAP_SIZE;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  ctx.globalCompositeOperation = "lighter"; // overlapping pools add up

  const toPx = (v) => ((v + FIELD_RADIUS) / (FIELD_RADIUS * 2)) * MAP_SIZE;
  const r = (POOL_RADIUS / (FIELD_RADIUS * 2)) * MAP_SIZE;
  for (const { x, z } of points) {
    const px = toPx(x);
    const pz = toPx(z);
    // Roughly inverse-square near the post, with a long soft tail.
    const g = ctx.createRadialGradient(px, pz, 0, px, pz, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.12, "rgba(255,255,255,0.6)");
    g.addColorStop(0.35, "rgba(255,255,255,0.22)");
    g.addColorStop(0.65, "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(px - r, pz - r, r * 2, r * 2);
  }

  const tex = new CanvasTexture(c);
  tex.flipY = false; // canvas row = +Z, matching the shader's lookup
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// GLSL: warm light arriving at world position `p`.
export const LAMP_LIGHT_GLSL = /* glsl */ `
  uniform sampler2D uLampMap;
  uniform float uLampStrength;
  uniform vec3  uLampColor;
  uniform float uLampField;
  uniform float uLampTop;
  vec3 lampLight(vec3 p) {
    if (uLampStrength <= 0.0) return vec3(0.0);
    vec2 uv = p.xz / (uLampField * 2.0) + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);
    float pool = texture2D(uLampMap, uv).r;
    // Walls and roofs high above the lanterns get less of it.
    float h = 1.0 - smoothstep(uLampTop * 0.9, uLampTop * 2.2, p.y);
    return uLampColor * pool * h * uLampStrength * 2.2;
  }
`;

/**
 * Makes a built-in material (Lambert / Standard / Physical) receive lamp
 * light. Use as props: <meshLambertMaterial {...LAMP_LIT} /> or apply to an
 * existing material with makeLampLit(material).
 */
export function patchLampLight(shader) {
  Object.assign(shader.uniforms, lampUniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vLampWorld;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vec4 lampLocal = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lampLocal = instanceMatrix * lampLocal; // instanced street lamps
      #endif
      vLampWorld = (modelMatrix * lampLocal).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nvarying vec3 vLampWorld;\n${LAMP_LIGHT_GLSL}`)
    .replace(
      "#include <lights_fragment_end>",
      "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * lampLight(vLampWorld);",
    );
}

const onBeforeCompile = patchLampLight;
const cacheKey = () => "lamp-lit";

export const LAMP_LIT = { onBeforeCompile, customProgramCacheKey: cacheKey };

export function makeLampLit(material) {
  material.onBeforeCompile = onBeforeCompile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;
  return material;
}
