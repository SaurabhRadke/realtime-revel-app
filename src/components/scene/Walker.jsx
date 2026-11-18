"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { EYE_HEIGHT, FIELD_RADIUS, WALK_SPEED } from "./config";
import { applyKey, input, resetInput } from "./controls";

const MAX_RADIUS = FIELD_RADIUS - 1.2; // stay inside the boundary wall
const LOOK_SPEED = 0.0035; // radians per dragged pixel
const MAX_PITCH = 1.2;

const _forward = new Vector3();
const _right = new Vector3();
const _target = new Vector3();

// First-person step: arrows move relative to where you're looking, with a
// little acceleration/deceleration so it feels like walking, not teleporting.
function stepWalker(camera, look, velocity, dt) {
  const f = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  _forward.set(-Math.sin(look.yaw), 0, -Math.cos(look.yaw));
  _right.set(Math.cos(look.yaw), 0, -Math.sin(look.yaw));
  _target.set(0, 0, 0).addScaledVector(_forward, f).addScaledVector(_right, s);
  if (_target.lengthSq() > 0) _target.normalize().multiplyScalar(WALK_SPEED);

  velocity.lerp(_target, 1 - Math.exp(-10 * dt));
  camera.position.addScaledVector(velocity, dt);

  const r = Math.hypot(camera.position.x, camera.position.z);
  if (r > MAX_RADIUS) {
    camera.position.x *= MAX_RADIUS / r;
    camera.position.z *= MAX_RADIUS / r;
  }
  camera.position.y = EYE_HEIGHT;
  camera.rotation.set(look.pitch, look.yaw, 0, "YXZ");
}

export default function Walker() {
  const gl = useThree((s) => s.gl);
  const look = useRef({ yaw: 0, pitch: -0.04 }); // facing down the main road (-Z)
  const velocity = useRef(new Vector3());

  // Keyboard arrows
  useEffect(() => {
    const down = (e) => applyKey(e.code, true) && e.preventDefault();
    const up = (e) => applyKey(e.code, false) && e.preventDefault();
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

  // Drag on the scene to turn your head
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const l = look.current;
      l.yaw -= (e.clientX - lastX) * LOOK_SPEED;
      l.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, l.pitch - (e.clientY - lastY) * LOOK_SPEED));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  useFrame((state, dt) => stepWalker(state.camera, look.current, velocity.current, Math.min(dt, 0.1)));

  return null;
}
