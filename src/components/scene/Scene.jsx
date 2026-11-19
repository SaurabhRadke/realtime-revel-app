"use client";

import { Suspense, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor, useProgress } from "@react-three/drei";
import Effects from "./Effects";
import Field from "./Field";
import Lighting from "./Lighting";
import Road from "./Road";
import NightSky from "./NightSky";
import Town from "./Town";
import Character from "./Character";
import PlayerController from "./PlayerController";
import Torch from "./Torch";
import { QUALITY_TIERS, START_POSITION } from "./config";
import styles from "./Scene.module.css";

// Pick a sensible starting tier; PerformanceMonitor then adjusts it live
// based on measured FPS (up on fast GPUs, down on slow ones).
function guessInitialTier() {
  if (typeof window === "undefined") return 1;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse) return 0;
  return cores >= 8 ? 2 : 1;
}

// Mounted inside the Suspense boundary, so it only runs once every model has
// loaded. Waits a few rendered frames (shader compile + texture upload happen
// on the first one) before lifting the loading screen.
function ReadySignal({ onReady }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 3) onReady();
  });
  return null;
}

function LoadingScreen({ ready }) {
  const { progress } = useProgress();
  return (
    <div className={`${styles.loading} ${ready ? styles.done : ""}`} aria-hidden={ready}>
      <div className={styles.box}>
        <span className={styles.label}>The town is settling in for the night…</span>
        <span className={styles.track}>
          <span className={styles.bar} style={{ width: `${ready ? 100 : Math.round(progress)}%` }} />
        </span>
      </div>
    </div>
  );
}

export default function Scene({ lampsOn = true, characterIndex = 0, thirdPerson = false }) {
  const [tier, setTier] = useState(guessInitialTier);
  const [ready, setReady] = useState(false);
  const q = QUALITY_TIERS[tier];

  return (
    <>
      <Canvas
        dpr={[1, q.dpr]}
        gl={{ antialias: false, stencil: false, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
        resize={{ debounce: 0 }}
        camera={{ position: START_POSITION, fov: 60, near: 0.05, far: 1500 }}
      >
        {/* One boundary for the whole world: nothing shows until every model
            has downloaded, then field, roads, houses and lamps appear together. */}
        <Suspense fallback={null}>
          <PerformanceMonitor
            flipflops={3}
            onIncline={() => setTier((t) => Math.min(t + 1, QUALITY_TIERS.length - 1))}
            onDecline={() => setTier((t) => Math.max(t - 1, 0))}
            onFallback={() => setTier(0)}
          />

          <Lighting />
          <NightSky />
          <Field bladeCount={q.blades} />
          <Road />
          <Town lampsOn={lampsOn} />

          <PlayerController thirdPerson={thirdPerson} />
          <Character index={characterIndex} />
          <Torch />

          <Effects multisampling={q.multisampling} />
          <ReadySignal onReady={() => setReady(true)} />
        </Suspense>
      </Canvas>
      <LoadingScreen ready={ready} />
    </>
  );
}
