// The player's torch beam, shared between the real three.js SpotLight (which
// lights ground, roads, houses) and the custom grass shader, which can't see
// three.js lights and computes the same spot cone itself from these uniforms.

import { Color, Vector3 } from "three";

export const TORCH = {
  color: "#ffd772", // warm yellow
  intensity: 42,
  distance: 40,
  angle: 0.36, // half-angle of the cone, radians
  penumbra: 0.55,
  decay: 1.3,
};

export const torchUniforms = {
  uTorchPos: { value: new Vector3(0, -100, 0) },
  uTorchDir: { value: new Vector3(0, -1, 0) },
  uTorchColor: { value: new Color(TORCH.color).multiplyScalar(TORCH.intensity) },
  uTorchCosOuter: { value: Math.cos(TORCH.angle) },
  uTorchCosInner: { value: Math.cos(TORCH.angle * (1 - TORCH.penumbra)) },
  uTorchDecay: { value: TORCH.decay },
  uTorchRange: { value: TORCH.distance },
};

// Same maths as three.js spot lights (cone, decay, range window), so the
// grass hotspot lines up with the one on the ground beneath it.
export const TORCH_LIGHT_GLSL = /* glsl */ `
  uniform vec3  uTorchPos;
  uniform vec3  uTorchDir;
  uniform vec3  uTorchColor;
  uniform float uTorchCosOuter;
  uniform float uTorchCosInner;
  uniform float uTorchDecay;
  uniform float uTorchRange;
  vec3 torchLight(vec3 p, vec3 n) {
    vec3 L = uTorchPos - p;
    float d = length(L);
    if (d > uTorchRange) return vec3(0.0);
    vec3 l = L / d;
    float cone = smoothstep(uTorchCosOuter, uTorchCosInner, dot(-l, uTorchDir));
    if (cone <= 0.0) return vec3(0.0);
    float win = clamp(1.0 - pow(d / uTorchRange, 4.0), 0.0, 1.0);
    float att = win * win / max(pow(d, uTorchDecay), 0.01);
    // Thin blades: light gets through from either side.
    float ndl = abs(dot(n, l)) * 0.6 + 0.4;
    return uTorchColor * att * cone * ndl;
  }
`;
