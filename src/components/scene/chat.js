// Proximity chat.
//
// Every player has an invisible circle around them. When two circles touch
// (characters within CHAT_RADIUS of each other) they can talk: a message pops
// up over the speaker's head in place of their name, lands in the chat log at
// the bottom of the screen, and reaches the phones of everyone in range.
//
// Who is near whom is measured by the scene every few frames (it knows where
// everyone stands) and written here; this module only notifies when the
// answer changes. No three.js here.

import { MAX_CHAT, cleanText } from "@/lib/connect/protocol";

export const CHAT_RADIUS = 6.5; // metres between two characters
export const CHAT_RELEASE = 7.5; // hysteresis: stay "near" until this far apart
export const BUBBLE_MS = 6500;
const LOG_SIZE = 40;
const MIN_GAP_MS = 700; // per player, so nobody can flood the screen

let state = {
  near: {}, // playerId -> [playerId] (sorted)
  bubbles: {}, // playerId -> {text, until}
  log: [], // [{key, playerId, name, color, text, at}]
};
const listeners = new Set();
const lastSaid = new Map();
let keySeq = 0;

function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export const chat = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => state,
};

export const nearOf = (playerId) => state.near[playerId] ?? [];

/** Scene -> here, with the freshly measured neighbour lists. */
export function setNear(next) {
  const prev = state.near;
  const ids = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const id of ids) {
    const a = prev[id] ?? [];
    const b = next[id] ?? [];
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      emit({ near: next });
      return true;
    }
  }
  return false;
}

/**
 * Player `entry` says `raw`. Returns the cleaned message or a reason it
 * didn't go out: "empty" | "alone" | "slow".
 */
export function say(entry, raw) {
  const text = cleanText(raw, MAX_CHAT);
  if (!text) return { error: "empty" };
  if (!nearOf(entry.id).length) return { error: "alone" };
  const now = Date.now();
  if (now - (lastSaid.get(entry.id) ?? 0) < MIN_GAP_MS) return { error: "slow" };
  lastSaid.set(entry.id, now);

  const until = now + BUBBLE_MS;
  const line = { key: ++keySeq, playerId: entry.id, name: entry.name, color: entry.color, text, at: now };
  emit({
    bubbles: { ...state.bubbles, [entry.id]: { text, until } },
    log: [...state.log, line].slice(-LOG_SIZE),
  });
  setTimeout(() => {
    if (state.bubbles[entry.id]?.until === until) {
      const { [entry.id]: _gone, ...rest } = state.bubbles;
      emit({ bubbles: rest });
    }
  }, BUBBLE_MS + 50);
  return { text, to: nearOf(entry.id) };
}

/** A player left: drop their bubble and neighbour list. */
export function forgetPlayer(playerId) {
  const { [playerId]: _b, ...bubbles } = state.bubbles;
  const near = {};
  for (const [id, list] of Object.entries(state.near)) {
    if (id !== playerId) near[id] = list.filter((v) => v !== playerId);
  }
  lastSaid.delete(playerId);
  emit({ bubbles, near });
}
