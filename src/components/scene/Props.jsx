"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import { AdditiveBlending, CanvasTexture, DoubleSide, RepeatWrapping, SRGBColorSpace } from "three";
import Typewriter from "@/components/ui/Typewriter";
import { Model } from "./Town";
import { makeLampLit } from "./lampLight";
import { getPlayerState } from "./player";
import { getPlayers } from "./roster";
import { NPCS, npcs, setNpcNear } from "./npcs";
import { CRATES, NPC_SPOTS, PROPS, SIGNPOST, TALK_RADIUS, TALK_RELEASE } from "./townProps";
import PROP_MODELS from "./propModels.json";
import styles from "./Props.module.css";

for (const p of PROP_MODELS) useGLTF.preload(p.url, false);
const MODEL = Object.fromEntries(PROP_MODELS.map((m) => [m.id, m]));

const LOOK_RANGE = 10; // townsfolk turn to face a player this close
const NPC_LIGHTS = {
  wick: { color: "#ffc16a", y: 1.3, intensity: 5, distance: 7 },
  hollow: { color: "#b98cff", y: 1.2, intensity: 4, distance: 7 },
  ember: { color: "#ff9a50", y: 1.6, intensity: 4.5, distance: 7 },
};

// ---------------------------------------------------------------------------
// Generated pieces (no model file): wooden crates and the crossroads signpost.
// ---------------------------------------------------------------------------

function woodTexture(w, h, { planks = 4, base = "#6b4a2b", dark = "#3d2915", edge = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Grain: thin wavy streaks.
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h;
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? "40,24,10" : "150,110,70"},${0.08 + Math.random() * 0.12})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += w / 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.5);
    ctx.stroke();
  }
  // Plank seams.
  ctx.fillStyle = dark;
  for (let i = 1; i < planks; i++) ctx.fillRect(0, (h / planks) * i - 2, w, 4);
  if (edge) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = w * 0.07;
    ctx.strokeRect(0, 0, w, h);
    // Diagonal brace.
    ctx.beginPath();
    ctx.moveTo(w * 0.08, h * 0.92);
    ctx.lineTo(w * 0.92, h * 0.08);
    ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function Crates() {
  const tex = useMemo(() => woodTexture(256, 256), []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group>
      {CRATES.map((c, i) => {
        const base = c.stackOn != null ? CRATES[c.stackOn] : null;
        const y = (base ? base.size : 0) + c.size / 2;
        return (
          <mesh key={i} position={[c.x, y, c.z]} rotation={[0, c.yaw, 0]}>
            <boxGeometry args={[c.size, c.size, c.size]} />
            <meshStandardMaterial map={tex} roughness={0.9} metalness={0} onUpdate={(m) => makeLampLit(m)} />
          </mesh>
        );
      })}
    </group>
  );
}

// An arrow-shaped board with a name on it. `dir` +1 points along +x, -1 along -x.
function boardTexture(text, dir) {
  const w = 512;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const tip = 70;
  ctx.beginPath();
  if (dir > 0) {
    ctx.moveTo(8, 14);
    ctx.lineTo(w - tip, 14);
    ctx.lineTo(w - 6, h / 2);
    ctx.lineTo(w - tip, h - 14);
    ctx.lineTo(8, h - 14);
  } else {
    ctx.moveTo(w - 8, 14);
    ctx.lineTo(tip, 14);
    ctx.lineTo(6, h / 2);
    ctx.lineTo(tip, h - 14);
    ctx.lineTo(w - 8, h - 14);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#8a6238");
  g.addColorStop(1, "#5b3b1e");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#2e1c0b";
  ctx.stroke();
  const family = getComputedStyle(document.body).fontFamily || "Georgia, serif";
  ctx.font = `54px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f6e3b8";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.fillText(text, w / 2 + (dir > 0 ? -tip / 3 : tip / 3), h / 2 + 3);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Boards: label, world direction it points (radians: 0 = +x), height.
const BOARDS = [
  { text: "Madame Hollow", angle: Math.PI, y: 2.25 },
  { text: "Ember's Cart", angle: 0, y: 1.9 },
  { text: "Town Gate", angle: Math.PI / 2, y: 1.55 },
];

function Signpost() {
  const res = useMemo(() => {
    const post = woodTexture(64, 256, { planks: 1, base: "#4f3520", edge: false });
    post.wrapS = post.wrapT = RepeatWrapping;
    const boards = BOARDS.map((b) => ({ ...b, front: boardTexture(b.text, 1), back: boardTexture(b.text, -1) }));
    return { post, boards };
  }, []);
  useEffect(
    () => () => {
      res.post.dispose();
      for (const b of res.boards) {
        b.front.dispose();
        b.back.dispose();
      }
    },
    [res],
  );
  const W = 1.5;
  const H = 0.375;
  return (
    <group position={[SIGNPOST.x, 0, SIGNPOST.z]}>
      <mesh position={[0, 1.35, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 2.7, 10]} />
        <meshStandardMaterial map={res.post} roughness={1} metalness={0} onUpdate={(m) => makeLampLit(m)} />
      </mesh>
      {res.boards.map((b) => (
        // Each board hangs off the post towards where it points.
        <group key={b.text} position={[0, b.y, 0]} rotation={[0, -b.angle, 0]}>
          <mesh position={[W / 2 + 0.05, 0, 0.012]}>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial map={b.front} transparent alphaTest={0.5} roughness={1} metalness={0} onUpdate={(m) => makeLampLit(m)} />
          </mesh>
          <mesh position={[W / 2 + 0.05, 0, -0.012]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial map={b.back} transparent alphaTest={0.5} roughness={1} metalness={0} onUpdate={(m) => makeLampLit(m)} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Townsfolk: idle bob and sway, turn to face whoever comes close, a name
// label (and what they're saying, typed out) over their head.
// ---------------------------------------------------------------------------

function NpcLabel({ id }) {
  const def = NPCS[id];
  const speech = useSyncExternalStore(npcs.subscribe, () => npcs.getSnapshot().speech[id], () => undefined);
  const near = useSyncExternalStore(
    npcs.subscribe,
    () => Object.values(npcs.getSnapshot().near).includes(id),
    () => false,
  );
  const solo = useSyncExternalStore(
    npcs.subscribe,
    () => getPlayers().length === 1 && !getPlayers()[0].peerId,
    () => false,
  );
  return (
    <div className={styles.tag} style={{ "--c": def.color }}>
      {speech && (
        <div className={styles.bubble} key={speech.key}>
          <span className={styles.speaker}>{def.name}</span>
          <Typewriter text={speech.text} cps={42} className={styles.bubbleText} />
        </div>
      )}
      <div className={styles.name} data-near={near}>
        <span className={styles.role}>{def.role}</span>
        <span>{def.name}</span>
        {near && <span className={styles.talk}>{solo ? "E · Talk" : "Talk on your phone"}</span>}
      </div>
    </div>
  );
}

function Npc({ id }) {
  const spot = NPC_SPOTS[id];
  const model = MODEL[spot.model];
  const scale = spot.size / model.height;
  const body = useRef(null);
  const ring = useRef(null);
  const state = useRef({ yaw: spot.yaw, t: spot.x * 0.37 }); // phase offset so they don't bob in step
  const ghost = id === "wick";
  const light = NPC_LIGHTS[id];

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = state.current;
    s.t += dt;
    // Face the nearest player in range, else drift back to the resting pose.
    let target = spot.yaw;
    let best = LOOK_RANGE;
    let anyNear = false;
    for (const e of getPlayers()) {
      const p = getPlayerState(e.id, e.slot);
      const d = Math.hypot(p.position.x - spot.x, p.position.z - spot.z);
      if (d < TALK_RADIUS) anyNear = true;
      if (d < best) {
        best = d;
        target = Math.atan2(p.position.x - spot.x, p.position.z - spot.z);
      }
    }
    const diff = Math.atan2(Math.sin(target - s.yaw), Math.cos(target - s.yaw));
    s.yaw += diff * (1 - Math.exp(-3 * dt));
    const g = body.current;
    if (g) {
      // Wick is a ghost: he floats. The others breathe and shift their weight.
      const bob = ghost ? 0.12 + Math.sin(s.t * 1.6) * 0.08 : Math.abs(Math.sin(s.t * 1.4)) * 0.025;
      g.position.y = bob;
      g.rotation.set(Math.sin(s.t * 0.9) * (ghost ? 0.04 : 0.015), s.yaw, Math.sin(s.t * 1.1) * (ghost ? 0.05 : 0.02));
      g.scale.set(scale, scale * (1 + Math.sin(s.t * 2.2) * 0.012), scale);
    }
    const r = ring.current;
    if (r) {
      const k = anyNear ? 1 : 0;
      r.material.opacity += (k * (0.55 + Math.sin(s.t * 4) * 0.15) - r.material.opacity) * Math.min(1, dt * 6);
      r.visible = r.material.opacity > 0.01;
      r.rotation.z = s.t * 0.4;
    }
  });

  return (
    <group position={[spot.x, 0, spot.z]}>
      <group ref={body}>
        <Model url={model.url} scale={1} />
      </group>
      {/* "You can talk" glow on the ground around them (drawn over the uneven road). */}
      <mesh ref={ring} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={3}>
        <ringGeometry args={[1.05, 1.2, 48]} />
        <meshBasicMaterial
          color={NPCS[id].color}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={AdditiveBlending}
          side={DoubleSide}
        />
      </mesh>
      <pointLight position={[0, light.y, 0.4]} color={light.color} intensity={light.intensity} distance={light.distance} decay={1.6} />
      <group position={[0, spot.size + (ghost ? 0.55 : 0.4), 0]}>
        <Html center zIndexRange={[2, 1]} pointerEvents="none">
          <NpcLabel id={id} />
        </Html>
      </group>
    </group>
  );
}

// Who stands within talking range of which townsfolk (with hysteresis).
function measureNear() {
  const prev = npcs.getSnapshot().near;
  const next = {};
  for (const e of getPlayers()) {
    const p = getPlayerState(e.id, e.slot);
    let best = null;
    let bestD = Infinity;
    for (const [id, spot] of Object.entries(NPC_SPOTS)) {
      const d = Math.hypot(p.position.x - spot.x, p.position.z - spot.z);
      const reach = prev[e.id] === id ? TALK_RELEASE : TALK_RADIUS;
      if (d < reach && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    if (best) next[e.id] = best;
  }
  setNpcNear(next);
}

function Prop({ prop }) {
  const model = MODEL[prop.model];
  if (!model) return null;
  return (
    <group position={[prop.x, 0, prop.z]} rotation={[0, prop.yaw, 0]}>
      <group scale={prop.scale}>
        <Model url={model.url} scale={1} />
      </group>
    </group>
  );
}

export default function Props() {
  const clock = useRef(0);
  useFrame((_, dt) => {
    clock.current -= dt;
    if (clock.current > 0) return;
    clock.current = 0.15;
    measureNear();
  });

  return (
    <group>
      {PROPS.map((p) => (
        <Prop key={p.id} prop={p} />
      ))}
      {Object.keys(NPC_SPOTS).map((id) => (
        <Npc key={id} id={id} />
      ))}
      <Crates />
      <Signpost />
      {/* The seer's cauldron glows. */}
      <pointLight position={[-33.6, 1.4, -1.5]} color="#8cff7a" intensity={3} distance={5} decay={1.8} />
    </group>
  );
}
