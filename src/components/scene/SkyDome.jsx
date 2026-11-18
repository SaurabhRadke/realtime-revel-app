"use client";

import { useEffect, useMemo } from "react";
import { BackSide, Color, ShaderMaterial, Vector3 } from "three";
import { PALETTE, SUN_POSITION } from "./config";

// A single cheap gradient dome with a soft hazy sun – no textures, no HDRI.
export default function SkyDome() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new Color(PALETTE.skyTop) },
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uFog: { value: new Color(PALETTE.fog) },
          uSun: { value: new Color(PALETTE.sun) },
          uSunDir: { value: new Vector3(...SUN_POSITION).normalize() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uHorizon, uFog, uSun, uSunDir;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float t = clamp(d.y, 0.0, 1.0);
            vec3 col = mix(uHorizon, uTop, pow(t, 0.42));
            col = mix(uFog, col, smoothstep(-0.02, 0.12, d.y));
            float s = max(dot(d, uSunDir), 0.0);
            col += uSun * (pow(s, 400.0) * 1.6 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[600, 32, 16]} />
    </mesh>
  );
}
