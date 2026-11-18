"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import Effects from "./Effects";
import Field from "./Field";
import Lighting from "./Lighting";
import Road from "./Road";
import SkyDome from "./SkyDome";
import Walker from "./Walker";
import { QUALITY_TIERS, START_POSITION } from "./config";

// Pick a sensible starting tier; PerformanceMonitor then adjusts it live
// based on measured FPS (up on fast GPUs, down on slow ones).
function guessInitialTier() {
  if (typeof window === "undefined") return 1;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse) return 0;
  return cores >= 8 ? 2 : 1;
}

export default function Scene() {
  const [tier, setTier] = useState(guessInitialTier);
  const q = QUALITY_TIERS[tier];

  return (
    <Canvas
      dpr={[1, q.dpr]}
      gl={{ antialias: false, stencil: false, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
      resize={{ debounce: 0 }}
      camera={{ position: START_POSITION, fov: 60, near: 0.05, far: 1500 }}
    >
      <PerformanceMonitor
        flipflops={3}
        onIncline={() => setTier((t) => Math.min(t + 1, QUALITY_TIERS.length - 1))}
        onDecline={() => setTier((t) => Math.max(t - 1, 0))}
        onFallback={() => setTier(0)}
      />

      <Lighting />
      <SkyDome />
      <Field bladeCount={q.blades} />
      <Road />

      <Walker />

      <Effects multisampling={q.multisampling} />
    </Canvas>
  );
}
