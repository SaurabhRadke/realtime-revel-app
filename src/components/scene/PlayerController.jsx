"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { FIELD_RADIUS } from "./config";
import { applyKey, input, resetInput } from "./controls";
import { getPlayerState, playerStates, dropPlayerState } from "./player";
import { isFresh, remotes } from "./remote";
import { getPlayers } from "./roster";
import { CHAT_RADIUS, CHAT_RELEASE, nearOf, setNear } from "./chat";
import { collideWithTown, isInsideHouse } from "./townLayout";
import { boostLeft } from "./game";

// ---- Movement ----
const WALK_SPEED = 3.0; // m/s
const RUN_SPEED = 5.8; // Shift / phone sprint
const SWIFT_BOOST = 1.45; // Ember's swift tonic
const KEY_TURN_SPEED = 1.9; // rad/s, ← → arrows
const BODY_RADIUS = 0.35;
const PLAYER_GAP = 0.75; // characters don't walk through each other
const MAX_RADIUS = FIELD_RADIUS - 1.2; // stay inside the boundary wall
export const STRIDE = 0.85; // metres per step (drives walk animation + head bob)

// ---- Looking: click/touch and drag (solo) ----
const DRAG_LOOK_SPEED = 0.0035; // radians per dragged pixel
const FPP_PITCH = [-1.2, 1.2];
const TPP_PITCH = [-0.75, 0.42];

// ---- Third-person camera (solo) ----
const TPP_DISTANCE = 3.6;
const TPP_SHOULDER = 0.55; // over the right shoulder
const TPP_RAISE = 0.35;
const SHOWCASE_DISTANCE = 3.3; // camera in front of the character while it is summoned
const AIM_MAX = 45; // metres; aiming at the sky points the torch this far out
const AIM_NDC = new Vector2(0, -0.08); // the torch points where you look, just below centre

// ---- Party camera (several players share the screen) ----
// High, fixed-heading view that frames everyone. Joysticks move relative to
// it ("up" = into the screen); swiping the phone's look pad swings the torch.
const PARTY_YAW = 0;
const PARTY_PITCH = -0.95; // ~54 degrees down
const PARTY_MIN_DIST = 12;
const PARTY_MAX_DIST = 70;
const PARTY_TORCH_PITCH = -0.32; // resting torch tilt: lights the ground a few metres ahead
const PARTY_AIM_MAX = 20;

// ---- Phone look pad (right half of the phone, swiped like a mobile shooter) ----
// Packets come at up to 60 Hz; the queued turn is eased in over a couple of
// frames so the view glides instead of stepping. Solo: it turns the camera. Party (fixed
// overhead camera): it swings that player's torch.
const LOOK_EASE = 40; // 1/s: ~90% of a swipe lands within ~0.06 s
const PARTY_PITCH_RANGE = [-1.05, 0.12]; // torch: down at the feet .. just over the horizon
const PARTY_LOOK_HOLD = 2500; // ms after the last swipe before the torch follows the walk again

const _move = new Vector3();
const _fpp = new Vector3();
const _tpp = new Vector3();
const _pivot = new Vector3();
const _off = new Vector3();
const _probe = new Vector3();
const _aim = new Vector3();
const _ray = new Raycaster();
const _prev = new Vector3();
const _soloPos = new Vector3();
const _soloQ = new Quaternion();
const _partyPos = new Vector3();
const _partyQ = new Quaternion();
const _origin = new Vector3();
const _dir = new Vector3();
const PARTY_Q = new Quaternion().setFromEuler(new Euler(PARTY_PITCH, PARTY_YAW, 0, "YXZ"));
const view = { thirdPerson: false }; // solo camera preference (V / phone button)

const party = { blend: 0, center: new Vector3(0, 0, 30), dist: PARTY_MIN_DIST, primed: false, nearClock: 0 };

const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Apply this frame's share of the phone's queued look. True while the player
// is steering the view/torch by hand (recent swipes).
function stepPhoneLook(p, r, dt, partyMode) {
  if (!r) return false;
  const k = 1 - Math.exp(-LOOK_EASE * dt);
  const dx = r.pendingYaw * k;
  const dy = r.pendingPitch * k;
  r.pendingYaw -= dx;
  r.pendingPitch -= dy;
  if (Math.abs(r.pendingYaw) < 1e-5) r.pendingYaw = 0;
  if (Math.abs(r.pendingPitch) < 1e-5) r.pendingPitch = 0;
  p.viewYaw = wrapAngle(p.viewYaw - dx);
  p.pitch += dy;
  if (partyMode) p.pitch = clamp(p.pitch, PARTY_PITCH_RANGE[0], PARTY_PITCH_RANGE[1]);
  return performance.now() - r.lastLook < PARTY_LOOK_HOLD;
}

// Third-person camera position for a given yaw/pitch, pulled in if a house
// is in the way so the view never ends up inside a wall.
function thirdPersonPosition(out, pivot, yaw, pitch, distance, shoulder) {
  _off.set(shoulder, TPP_RAISE, distance);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rotate by pitch (about X) then yaw (about Y), like the camera itself.
  const y1 = _off.y * cp - _off.z * sp;
  const z1 = _off.y * sp + _off.z * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  _off.set(_off.x * cy + z1 * sy, y1, -_off.x * sy + z1 * cy);

  let k = 1;
  for (let t = 0.15; t <= 1.0001; t += 0.05) {
    _probe.copy(pivot).addScaledVector(_off, t);
    if (_probe.y < 12 && isInsideHouse(_probe.x, _probe.z, 0.35)) {
      k = Math.max(0.12, t - 0.08);
      break;
    }
  }
  out.copy(pivot).addScaledVector(_off, k);
  out.y = Math.max(out.y, 0.35);
  return out;
}

// One character's movement for this frame.
function stepBody(p, r, dt, { keyboard, partyMode, id }) {
  // -- Phone: the look pad turns the view (solo) or the torch (party) --
  const steering = stepPhoneLook(p, r, dt, partyMode);

  // -- Turning: arrow keys (dragging turns the view in the pointer handlers) --
  if (keyboard) {
    const keyTurn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    p.viewYaw += keyTurn * KEY_TURN_SPEED * dt;
  }
  p.pitch = clamp(p.pitch, FPP_PITCH[0], FPP_PITCH[1]);

  // -- Walking: solo relative to the view, party relative to the shared camera --
  // Keys are digital; the phone joystick is analog (half push = slow walk).
  const fresh = isFresh(r);
  const kb = keyboard ? input : null;
  const f = (kb?.forward ? 1 : 0) - (kb?.backward ? 1 : 0) + (fresh ? r.joyY : 0);
  const s = (kb?.strafeRight ? 1 : 0) - (kb?.strafeLeft ? 1 : 0) + (fresh ? r.joyX : 0);
  const running = !!kb?.run || (fresh && r.run);
  const frameYaw = partyMode ? PARTY_YAW : p.viewYaw;
  const sin = Math.sin(frameYaw);
  const cos = Math.cos(frameYaw);
  _move.set(-sin * f + cos * s, 0, -cos * f - sin * s);
  if (_move.lengthSq() > 1) _move.normalize();
  _move.multiplyScalar((running ? RUN_SPEED : WALK_SPEED) * (boostLeft(id, "swift") > 0 ? SWIFT_BOOST : 1));
  p.velocity.lerp(_move, 1 - Math.exp(-16 * dt)); // quick start/stop: the stick feels direct

  _prev.copy(p.position);
  p.position.addScaledVector(p.velocity, dt);
  const rad = Math.hypot(p.position.x, p.position.z);
  if (rad > MAX_RADIUS) {
    p.position.x *= MAX_RADIUS / rad;
    p.position.z *= MAX_RADIUS / rad;
  }
  collideWithTown(p.position, BODY_RADIUS);
  p.position.y = 0;
  const moved = Math.hypot(p.position.x - _prev.x, p.position.z - _prev.z);
  p.speed = dt > 0 ? moved / dt : 0;

  // Party, not swiping lately: the torch simply looks where you walk.
  if (partyMode && !steering) {
    if (p.speed > 0.4) {
      const walkYaw = Math.atan2(-(p.position.x - _prev.x), -(p.position.z - _prev.z));
      p.viewYaw = wrapAngle(p.viewYaw + wrapAngle(walkYaw - p.viewYaw) * (1 - Math.exp(-6 * dt)));
    }
    p.pitch += (PARTY_TORCH_PITCH - p.pitch) * (1 - Math.exp(-4 * dt));
  }

  // -- Body facing: walk direction when moving, else towards the torch aim --
  let target = p.bodyYaw;
  if (p.showcase) {
    target = p.viewYaw; // face the (orbiting) camera's subject direction
  } else if (p.speed > 0.4) {
    target = Math.atan2(-(p.position.x - _prev.x), -(p.position.z - _prev.z));
  } else {
    const ax = p.aim.x - p.position.x;
    const az = p.aim.z - p.position.z;
    if (ax * ax + az * az > 2) target = Math.atan2(-ax, -az);
  }
  const diff = wrapAngle(target - p.bodyYaw);
  const maxTurn = 7 * dt;
  const turn = clamp(diff * (1 - Math.exp(-10 * dt)), -maxTurn, maxTurn);
  p.bodyYaw = wrapAngle(p.bodyYaw + turn);
  p.turnRate = dt > 0 ? turn / dt : 0;

  // Step clock: one step per STRIDE walked; turning on the spot shuffles too.
  p.walkPhase += ((p.speed / STRIDE) * Math.PI + Math.min(Math.abs(p.turnRate), 4) * 1.6) * dt;
}

// Characters gently push apart so two players never stand inside each other.
function separate(states) {
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i].position;
      const b = states[j].position;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= PLAYER_GAP) continue;
      const nx = d > 1e-4 ? dx / d : 1;
      const nz = d > 1e-4 ? dz / d : 0;
      const push = (PLAYER_GAP - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }
}

// Solo: the camera sits in (or behind) the one character.
function soloCamera(p, camera, dt, outPos, outQ) {
  const blendTarget = p.wantThirdPerson || p.showcase ? 1 : 0;
  p.camBlend += (blendTarget - p.camBlend) * (1 - Math.exp(-3.5 * dt));
  p.orbit += ((p.showcase ? 1 : 0) - p.orbit) * (1 - Math.exp(-2.6 * dt));
  const e = smooth(clamp(p.camBlend, 0, 1));
  const o = smooth(clamp(p.orbit, 0, 1));

  const camYaw = p.viewYaw + o * Math.PI;
  const tppPitch = clamp(p.pitch, TPP_PITCH[0], TPP_PITCH[1]);
  const pitch = p.pitch + (tppPitch - p.pitch) * e;
  const camPitch = pitch + (-0.12 - pitch) * o; // showcase: level, slightly down

  const bob = Math.abs(Math.sin(p.walkPhase)) * 0.045 * Math.min(1, p.speed / WALK_SPEED);
  _fpp.set(p.position.x, p.eyeHeight + bob, p.position.z);
  _pivot.set(p.position.x, p.eyeHeight * 0.86, p.position.z);
  thirdPersonPosition(_tpp, _pivot, camYaw, camPitch, TPP_DISTANCE + (SHOWCASE_DISTANCE - TPP_DISTANCE) * o, TPP_SHOULDER * (1 - o));
  outPos.lerpVectors(_fpp, _tpp, e);
  camera.rotation.set(camPitch, camYaw, 0, "YXZ");
  outQ.copy(camera.quaternion);
  return o;
}

// Party: frame everyone from above.
function partyCamera(states, dt, aspect, outPos, outQ) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of states) {
    minX = Math.min(minX, p.position.x);
    maxX = Math.max(maxX, p.position.x);
    minZ = Math.min(minZ, p.position.z);
    maxZ = Math.max(maxZ, p.position.z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Spread across the screen (x, scaled for a narrow window) and into it (z).
  const spread = Math.max((maxX - minX) / Math.max(0.8, aspect), (maxZ - minZ) * 0.85);
  const dist = clamp(PARTY_MIN_DIST + spread * 1.15, PARTY_MIN_DIST, PARTY_MAX_DIST);

  const k = party.primed ? 1 - Math.exp(-2.4 * dt) : 1;
  party.primed = true;
  party.center.x += (cx - party.center.x) * k;
  party.center.z += (cz - party.center.z) * k;
  party.dist += (dist - party.dist) * k;

  const d = party.dist;
  outPos.set(party.center.x, 1 + d * Math.sin(-PARTY_PITCH), party.center.z + d * Math.cos(PARTY_PITCH));
  outQ.copy(PARTY_Q);
}

// Solo: the torch points where the view looks (screen-centre ray).
function soloAim(p, camera, dt) {
  _ray.setFromCamera(AIM_NDC, camera);
  const { origin, direction } = _ray.ray;
  let dist = AIM_MAX;
  if (direction.y < -1e-3) dist = Math.min(dist, -origin.y / direction.y);
  _aim.copy(origin).addScaledVector(direction, dist);
  p.aim.lerp(_aim, 1 - Math.exp(-20 * dt));
}

// Party: the torch points along the character's own yaw/pitch.
function torchAim(p, dt) {
  _origin.set(p.position.x, p.eyeHeight * 0.7, p.position.z);
  const cp = Math.cos(p.pitch);
  _dir.set(-Math.sin(p.viewYaw) * cp, Math.sin(p.pitch), -Math.cos(p.viewYaw) * cp);
  let dist = PARTY_AIM_MAX;
  if (_dir.y < -1e-3) dist = Math.min(dist, -_origin.y / _dir.y);
  _aim.copy(_origin).addScaledVector(_dir, Math.max(1.5, dist));
  p.aim.lerp(_aim, 1 - Math.exp(-16 * dt));
}

// Who stands inside whose chat circle (with a little hysteresis).
function measureNear(players, states) {
  const next = {};
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    const list = [];
    const was = nearOf(a.id);
    for (let j = 0; j < players.length; j++) {
      if (i === j) continue;
      const b = players[j];
      const d = states[i].position.distanceTo(states[j].position);
      if (d < CHAT_RADIUS || (d < CHAT_RELEASE && was.includes(b.id))) list.push(b.id);
    }
    if (list.length) next[a.id] = list.sort();
  }
  setNear(next);
}

const _states = [];

function stepWorld(state, dt) {
  const players = getPlayers();
  const partyMode = players.length > 1;
  const camera = state.camera;

  // Forget characters whose players have left.
  if (playerStates.size !== players.length) {
    for (const id of [...playerStates.keys()]) if (!players.some((e) => e.id === id)) dropPlayerState(id);
  }

  _states.length = 0;
  for (const e of players) {
    const p = getPlayerState(e.id, e.slot);
    _states.push(p);
    const r = e.peerId ? remotes.get(e.peerId) : null;
    stepBody(p, r, dt, { keyboard: !partyMode, partyMode, id: e.id });
  }
  if (partyMode) separate(_states);

  // -- Camera: solo (first/third person) <-> party (overview), eased --
  party.blend += ((partyMode ? 1 : 0) - party.blend) * (1 - Math.exp(-2.2 * dt));
  if (Math.abs(party.blend - (partyMode ? 1 : 0)) < 0.002) party.blend = partyMode ? 1 : 0;
  const k = smooth(party.blend);
  const lead = _states[0];
  if (lead) lead.wantThirdPerson = view.thirdPerson;
  let orbit = 0;
  if (lead && k < 1) orbit = soloCamera(lead, camera, dt, _soloPos, _soloQ);
  if (k > 0) {
    partyCamera(_states, dt, state.size.width / Math.max(1, state.size.height), _partyPos, _partyQ);
  } else {
    party.primed = false;
  }
  if (k <= 0) {
    camera.position.copy(_soloPos);
    camera.quaternion.copy(_soloQ);
  } else if (k >= 1 || !lead) {
    camera.position.copy(_partyPos);
    camera.quaternion.copy(_partyQ);
  } else {
    camera.position.lerpVectors(_soloPos, _partyPos, k);
    camera.quaternion.slerpQuaternions(_soloQ, _partyQ, k);
  }
  camera.updateMatrixWorld();

  // -- Aim + first-person flags --
  for (let i = 0; i < _states.length; i++) {
    const p = _states[i];
    if (!partyMode && i === 0) {
      // Held still during a showcase, when the camera looks back at the player.
      if (!p.showcase && orbit < 0.02 && k < 0.5) soloAim(p, camera, dt);
      p.firstPerson = p.camBlend <= 0.12 && k < 0.5;
    } else {
      torchAim(p, dt);
      p.firstPerson = false;
      p.camBlend = 1;
    }
  }

  // -- Chat circles, a few times a second --
  party.nearClock -= dt;
  if (party.nearClock <= 0) {
    party.nearClock = 0.2;
    measureNear(players, _states);
  }
}

export default function PlayerController({ thirdPerson }) {
  const gl = useThree((s) => s.gl);
  const look = useRef({ dragging: false });

  useEffect(() => {
    view.thirdPerson = thirdPerson;
  }, [thirdPerson]);

  // Keyboard: walks the character only while one person plays. With several
  // players the phones drive and the keyboard belongs to the chat box.
  useEffect(() => {
    const typing = (e) => e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
    const down = (e) => {
      if (getPlayers().length > 1 || typing(e)) return;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.run = true;
      if (applyKey(e.code, true)) e.preventDefault();
    };
    const up = (e) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.run = false;
      applyKey(e.code, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", resetInput);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", resetInput);
      resetInput();
    };
  }, []);

  // Click (or touch) and drag on the scene to look around (solo only).
  useEffect(() => {
    const el = gl.domElement;
    let lastX = 0;
    let lastY = 0;
    const onWindowMove = (e) => {
      if (!look.current.dragging) return;
      const players = getPlayers();
      if (players.length === 1) {
        const p = getPlayerState(players[0].id);
        p.viewYaw -= (e.clientX - lastX) * DRAG_LOOK_SPEED;
        p.pitch -= (e.clientY - lastY) * DRAG_LOOK_SPEED;
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onDown = (e) => {
      look.current.dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onUp = () => {
      look.current.dragging = false;
    };
    window.addEventListener("pointermove", onWindowMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onWindowMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  // Runs before the characters/torches (-2, -1) so they see this frame's state.
  useFrame((state, dt) => stepWorld(state, Math.min(dt, 0.1)), -3);

  return null;
}
