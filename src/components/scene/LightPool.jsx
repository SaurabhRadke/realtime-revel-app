"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { TORCH } from "./torchLight";
import { flashLight, glowLight, torchSpots } from "./sharedLights";

// The fixed set of dynamic lights (see sharedLights.js). Characters (-2) and
// torches (-1.5) write their wishes first; this applies them at -1.
export default function LightPool() {
  const spots = useRef([]);
  const targets = useRef([]);
  const glow = useRef(null);
  const flash = useRef(null);

  useEffect(() => {
    spots.current.forEach((s, i) => {
      if (s && targets.current[i]) s.target = targets.current[i];
    });
  }, []);

  useFrame(() => {
    torchSpots.forEach((d, i) => {
      const s = spots.current[i];
      const t = targets.current[i];
      if (!s || !t) return;
      s.position.copy(d.position);
      s.intensity = d.intensity;
      t.position.copy(d.target);
      t.updateMatrixWorld();
    });
    if (glow.current) {
      glow.current.position.copy(glowLight.position);
      glow.current.intensity = glowLight.intensity;
    }
    if (flash.current) {
      flash.current.position.copy(flashLight.position);
      flash.current.intensity = flashLight.intensity;
      flash.current.color.copy(flashLight.color);
    }
    flashLight.intensity = 0; // characters bid again next frame
  }, -1);

  return (
    <>
      {torchSpots.map((_, i) => (
        <group key={i}>
          <spotLight
            ref={(el) => {
              spots.current[i] = el;
            }}
            color={TORCH.color}
            angle={TORCH.angle}
            penumbra={TORCH.penumbra}
            decay={TORCH.decay}
            distance={TORCH.distance}
            intensity={0}
          />
          <object3D
            ref={(el) => {
              targets.current[i] = el;
            }}
          />
        </group>
      ))}
      <pointLight ref={glow} color={TORCH.color} distance={3.5} decay={2} intensity={0} />
      <pointLight ref={flash} distance={12} decay={1.6} intensity={0} />
    </>
  );
}
