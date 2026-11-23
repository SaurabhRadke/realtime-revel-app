"use client";

import { Suspense, useRef, useState, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { WebGLRenderTarget } from "three";
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
import LightPool from "./LightPool";
import NameTag from "./NameTag";
import Treasure from "./Treasure";
import Props from "./Props";
import { game, lampLevel } from "./game";
import { roster } from "./roster";
import { QUALITY_TIERS, START_POSITION } from "./config";
import { setLodView, startLodLoading } from "./lod";
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

// Compiles the shaders of EVERYTHING in the scene, including what is hidden
// right now (treasure, sparks, compasses, chest beam...), so they don't stall
// a frame mid-game the first time they appear. Compiled against a render
// target, i.e. the same shader variant the post-processing pass renders with.
function precompile(gl, scene, camera) {
  const target = new WebGLRenderTarget(1, 1);
  const previous = gl.getRenderTarget();
  let done;
  try {
    gl.setRenderTarget(target);
    done = gl.compileAsync(scene, camera); // compiles synchronously, then waits
  } catch {
    done = Promise.resolve();
  } finally {
    gl.setRenderTarget(previous);
    target.dispose();
  }
  // Never hold the loading screen hostage: give up waiting after 4 s.
  return Promise.race([done.catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
}

// Mounted inside the Suspense boundary, so it only runs once every model has
// loaded. Waits a few rendered frames (texture upload happens on the first
// one), precompiles every shader, then lifts the loading screen and starts
// fetching the distance LODs in the background.
function ReadySignal({ onReady }) {
  const frames = useRef(0);
  useFrame(({ gl, scene, camera }) => {
    frames.current += 1;
    if (frames.current !== 3) return;
    precompile(gl, scene, camera).then(() => {
      onReady();
      startLodLoading();
    });
  });
  return null;
}

// Keeps the LOD switch distances matched to the real pixel size (render
// height x device pixel ratio, camera field of view).
function LodView() {
  useFrame(({ camera, size, viewport }) => setLodView(camera.fov, size.height * viewport.dpr));
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

export default function Scene({ lampsOn = true, thirdPerson = false }) {
  const players = useSyncExternalStore(roster.subscribe, roster.getSnapshot, roster.getSnapshot);
  const lamps = useSyncExternalStore(game.subscribe, () => lampLevel(game.getSnapshot()), () => 1);
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
          <Town lampsOn={lampsOn} lampLevel={lamps} />
          <Props />

          <PlayerController thirdPerson={thirdPerson} />
          <LightPool />
          {players.map((p, i) => (
            <group key={p.id}>
              <Character id={p.id} slot={p.slot} index={p.character} />
              <Torch id={p.id} slot={p.slot} lead={i === 0} />
              <NameTag entry={p} />
            </group>
          ))}
          <Treasure />

          <Effects multisampling={q.multisampling} />
          <LodView />
          <ReadySignal onReady={() => setReady(true)} />
        </Suspense>
      </Canvas>
      <LoadingScreen ready={ready} />
    </>
  );
}
