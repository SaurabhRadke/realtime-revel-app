"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { FIELD_RADIUS } from "./config";
import { applyKey, input, resetInput } from "./controls";
import { player } from "./player";
import { REMOTE_STALE_MS, remote } from "./remote";
import { collideWithTown, isInsideHouse } from "./townLayout";

// ---- Movement ----
const WALK_SPEED = 3.0; // m/s
const RUN_SPEED = 5.6; // with Shift
const KEY_TURN_SPEED = 1.9; // rad/s, ← → arrows
const BODY_RADIUS = 0.35;
const MAX_RADIUS = FIELD_RADIUS - 1.2; // stay inside the boundary wall
export const STRIDE = 0.85; // metres per step (drives walk animation + head bob)

// ---- Looking: click/touch and drag ----
const DRAG_LOOK_SPEED = 0.0035; // radians per dragged pixel
const FPP_PITCH = [-1.2, 1.2];
const TPP_PITCH = [-0.75, 0.42];

// ---- Third-person camera ----
const TPP_DISTANCE = 3.6;
const TPP_SHOULDER = 0.55; // over the right shoulder
const TPP_RAISE = 0.35;
const SHOWCASE_DISTANCE = 3.3; // camera in front of the character while it is summoned
const AIM_MAX = 45; // metres; aiming at the sky points the torch this far out
const AIM_NDC = new Vector2(0, -0.08); // the torch points where you look, just below centre

const _move = new Vector3();
const _fpp = new Vector3();
const _tpp = new Vector3();
const _pivot = new Vector3();
const _off = new Vector3();
const _probe = new Vector3();
const _aim = new Vector3();
const _ray = new Raycaster();
const _prev = new Vector3();
const _phoneQ = new Quaternion();
const _phoneTarget = new Quaternion();
const _phoneUp = new Vector3();

// ---- Phone (gyro) aiming ----
// The phone's top edge is the torch. Its heading drives the view yaw
// incrementally (so mouse/keys still work alongside), its elevation drives
// pitch absolutely, relative to the tilt captured at calibration.
const PHONE_SMOOTHING = 22; // 1/s, slerp rate towards the latest packet
const PHONE_YAW_GAIN = 1.0;
const PHONE_PITCH_GAIN = 1.0;
const phone = { calibration: -1, lastHeading: null, pitchZero: 0, primed: false };

function stepPhoneAim(dt) {
  const live = remote.connected && remote.hasGyro && performance.now() - remote.lastPacket < 1500;
  if (!live || !remote.torchFollow) {
    phone.lastHeading = null; // re-anchor (no jump) when aiming resumes
    phone.primed = false;
    return;
  }
  _phoneTarget.set(remote.q[0], remote.q[1], remote.q[2], remote.q[3]).normalize();
  if (!phone.primed) {
    _phoneQ.copy(_phoneTarget);
    phone.primed = true;
  } else {
    _phoneQ.slerp(_phoneTarget, 1 - Math.exp(-PHONE_SMOOTHING * dt));
  }

  // Top edge of the phone (device +Y) in the earth frame: x east, y north, z up.
  _phoneUp.set(0, 1, 0).applyQuaternion(_phoneQ);
  const elevation = Math.asin(Math.max(-1, Math.min(1, _phoneUp.z)));

  // Recenter / new phone: its current tilt becomes "looking level".
  if (phone.calibration !== remote.calibration) {
    phone.calibration = remote.calibration;
    phone.pitchZero = elevation;
    phone.lastHeading = null;
  }

  // Heading is meaningless when pointing straight up/down: hold it there.
  if (Math.abs(_phoneUp.z) < 0.96) {
    const heading = Math.atan2(_phoneUp.x, _phoneUp.y); // clockwise from north
    if (phone.lastHeading !== null) {
      player.viewYaw -= wrapAngle(heading - phone.lastHeading) * PHONE_YAW_GAIN;
    }
    phone.lastHeading = heading;
  } else {
    phone.lastHeading = null;
  }

  const targetPitch = (elevation - phone.pitchZero) * PHONE_PITCH_GAIN;
  player.pitch += (targetPitch - player.pitch) * (1 - Math.exp(-30 * dt));
}

const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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

function stepPlayer(camera, dt) {
  const p = player;

  // -- Phone: gyro aims the view (and so the torch) --
  stepPhoneAim(dt);

  // -- Turning: arrow keys (dragging turns the view in the pointer handlers) --
  const keyTurn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  p.viewYaw += keyTurn * KEY_TURN_SPEED * dt;
  p.pitch = Math.max(FPP_PITCH[0], Math.min(FPP_PITCH[1], p.pitch));

  // -- Walking, relative to where the view faces --
  // Keys are digital; the phone joystick is analog (half push = slow walk).
  const phoneFresh = remote.connected && performance.now() - remote.lastPacket < REMOTE_STALE_MS;
  const f = (input.forward ? 1 : 0) - (input.backward ? 1 : 0) + (phoneFresh ? remote.joyY : 0);
  const s = (input.strafeRight ? 1 : 0) - (input.strafeLeft ? 1 : 0) + (phoneFresh ? remote.joyX : 0);
  const running = input.run || (phoneFresh && remote.run);
  const sin = Math.sin(p.viewYaw);
  const cos = Math.cos(p.viewYaw);
  _move.set(-sin * f + cos * s, 0, -cos * f - sin * s);
  if (_move.lengthSq() > 1) _move.normalize();
  _move.multiplyScalar(running ? RUN_SPEED : WALK_SPEED);
  p.velocity.lerp(_move, 1 - Math.exp(-9 * dt));

  _prev.copy(p.position);
  p.position.addScaledVector(p.velocity, dt);
  const r = Math.hypot(p.position.x, p.position.z);
  if (r > MAX_RADIUS) {
    p.position.x *= MAX_RADIUS / r;
    p.position.z *= MAX_RADIUS / r;
  }
  collideWithTown(p.position, BODY_RADIUS);
  p.position.y = 0;
  const moved = Math.hypot(p.position.x - _prev.x, p.position.z - _prev.z);
  p.speed = dt > 0 ? moved / dt : 0;

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
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff * (1 - Math.exp(-10 * dt))));
  p.bodyYaw = wrapAngle(p.bodyYaw + turn);
  p.turnRate = dt > 0 ? turn / dt : 0;

  // Step clock: one step per STRIDE walked; turning on the spot shuffles too.
  p.walkPhase += ((p.speed / STRIDE) * Math.PI + Math.min(Math.abs(p.turnRate), 4) * 1.6) * dt;

  // -- Camera: blend first person <-> third person, orbit to the front for showcases --
  const blendTarget = p.wantThirdPerson || p.showcase ? 1 : 0;
  p.camBlend += (blendTarget - p.camBlend) * (1 - Math.exp(-3.5 * dt));
  p.orbit += ((p.showcase ? 1 : 0) - p.orbit) * (1 - Math.exp(-2.6 * dt));
  const e = smooth(Math.min(1, Math.max(0, p.camBlend)));
  const o = smooth(Math.min(1, Math.max(0, p.orbit)));

  const camYaw = p.viewYaw + o * Math.PI;
  const tppPitch = Math.max(TPP_PITCH[0], Math.min(TPP_PITCH[1], p.pitch));
  const pitch = p.pitch + (tppPitch - p.pitch) * e;
  const camPitch = pitch + (-0.12 - pitch) * o; // showcase: level, slightly down

  const bob = Math.abs(Math.sin(p.walkPhase)) * 0.045 * Math.min(1, p.speed / WALK_SPEED);
  _fpp.set(p.position.x, p.eyeHeight + bob, p.position.z);
  _pivot.set(p.position.x, p.eyeHeight * 0.86, p.position.z);
  thirdPersonPosition(
    _tpp,
    _pivot,
    camYaw,
    camPitch,
    TPP_DISTANCE + (SHOWCASE_DISTANCE - TPP_DISTANCE) * o,
    TPP_SHOULDER * (1 - o),
  );
  camera.position.lerpVectors(_fpp, _tpp, e);
  camera.rotation.set(camPitch, camYaw, 0, "YXZ");
  camera.updateMatrixWorld();

  // -- Aim: where the view looks --
  // Held still during a showcase, when the camera looks back at the player.
  if (!p.showcase && o < 0.02) {
    _ray.setFromCamera(AIM_NDC, camera);
    const { origin, direction } = _ray.ray;
    let dist = AIM_MAX;
    if (direction.y < -1e-3) dist = Math.min(dist, -origin.y / direction.y);
    _aim.copy(origin).addScaledVector(direction, dist);
    p.aim.lerp(_aim, 1 - Math.exp(-20 * dt));
  }
}

export default function PlayerController({ thirdPerson }) {
  const gl = useThree((s) => s.gl);
  const look = useRef({ dragging: false });

  useEffect(() => {
    player.wantThirdPerson = thirdPerson;
  }, [thirdPerson]);

  // Keyboard
  useEffect(() => {
    const down = (e) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.run = true;
      if (applyKey(e.code, true)) e.preventDefault();
    };
    const up = (e) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.run = false;
      if (applyKey(e.code, false)) e.preventDefault();
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

  // Click (or touch) and drag on the scene to look around.
  useEffect(() => {
    const el = gl.domElement;
    let lastX = 0;
    let lastY = 0;
    const onWindowMove = (e) => {
      if (!look.current.dragging) return;
      player.viewYaw -= (e.clientX - lastX) * DRAG_LOOK_SPEED;
      player.pitch -= (e.clientY - lastY) * DRAG_LOOK_SPEED;
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

  // Runs before the character/torch (-2) so they see this frame's state.
  useFrame((state, dt) => stepPlayer(state.camera, Math.min(dt, 0.1)), -3);

  return null;
}
