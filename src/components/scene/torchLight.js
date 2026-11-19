// The players' torch beams, shared between the real three.js SpotLights (which
// light ground, roads, houses) and the custom grass shader, which can't see
// three.js lights and computes the same spot cones itself from these uniforms.
// One entry per player slot; unused slots have zero colour.

import { Color, Vector3 } from "three";
import { MAX_PLAYERS } from "./roster";

export const TORCH_COUNT = MAX_PLAYERS;

export const TORCH = {
  color: "#ffd772", // warm yellow
  intensity: 42,
  distance: 40,
  angle: 0.36, // half-angle of the cone, radians
  penumbra: 0.55,
  decay: 1.3,
};

export const torchUniforms = {
  uTorchPos: { value: Array.from({ length: TORCH_COUNT }, () => new Vector3(0, -100, 0)) },
  uTorchDir: { value: Array.from({ length: TORCH_COUNT }, () => new Vector3(0, -1, 0)) },
  uTorchColor: { value: Array.from({ length: TORCH_COUNT }, () => new Color(0, 0, 0)) },
  uTorchCosOuter: { value: Math.cos(TORCH.angle) },
  uTorchCosInner: { value: Math.cos(TORCH.angle * (1 - TORCH.penumbra)) },
  uTorchDecay: { value: TORCH.decay },
  uTorchRange: { value: TORCH.distance },
};

// Same maths as three.js spot lights (cone, decay, range window), so the
// grass hotspot lines up with the one on the ground beneath it.
export const TORCH_LIGHT_GLSL = /* glsl */ `
  uniform vec3  uTorchPos[${TORCH_COUNT}];
  uniform vec3  uTorchDir[${TORCH_COUNT}];
  uniform vec3  uTorchColor[${TORCH_COUNT}];
  uniform float uTorchCosOuter;
  uniform float uTorchCosInner;
  uniform float uTorchDecay;
  uniform float uTorchRange;
  vec3 torchLight(vec3 p, vec3 n) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${TORCH_COUNT}; i++) {
      vec3 col = uTorchColor[i];
      if (col.r + col.g + col.b <= 0.0) continue;
      vec3 L = uTorchPos[i] - p;
      float d = length(L);
      if (d > uTorchRange) continue;
      vec3 l = L / d;
      float cone = smoothstep(uTorchCosOuter, uTorchCosInner, dot(-l, uTorchDir[i]));
      if (cone <= 0.0) continue;
      float win = clamp(1.0 - pow(d / uTorchRange, 4.0), 0.0, 1.0);
      float att = win * win / max(pow(d, uTorchDecay), 0.01);
      // Thin blades: light gets through from either side.
      float ndl = abs(dot(n, l)) * 0.6 + 0.4;
      sum += col * att * cone * ndl;
    }
    return sum;
  }
`;
