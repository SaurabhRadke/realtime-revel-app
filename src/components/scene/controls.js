// Tiny shared input state for walking. Written by keyboard arrows (inside the
// scene) and by the on-screen arrow buttons (DOM overlay); read every frame.
// No three.js import here, so the overlay can use it without pulling in 3D code.

export const input = { forward: false, backward: false, left: false, right: false };

const KEY_TO_DIR = {
  ArrowUp: "forward",
  ArrowDown: "backward",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function setInput(dir, pressed) {
  input[dir] = pressed;
}

export function resetInput() {
  for (const k of Object.keys(input)) input[k] = false;
}

// Returns true if the key was one of ours (so the caller can preventDefault).
export function applyKey(code, pressed) {
  const dir = KEY_TO_DIR[code];
  if (!dir) return false;
  input[dir] = pressed;
  return true;
}
