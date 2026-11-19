// "Lanterns & Keys": the treasure hunt rules.
//
//   1. Gold coins are scattered through the town: walk over them (+1 gold).
//   2. Three old keys are hidden in the dark, off the lamp-lit roads. A key
//      only shows itself when a torch beam (or someone standing right next
//      to it) lights it up, so sweep the phone around like a real torch.
//      Picking one up is +5 gold.
//   3. With all three keys found the treasure chest at the crossroads
//      unlocks. The first to reach it opens it (+10 gold) and ends the round.
//   4. If the moon sets first (the timer), the round ends where it stands.
//   Most gold wins.
//
// Item positions live in the scene (it knows the town layout); this module
// keeps the rules, scores and phase, and notifies the UI on every change.
// No three.js here.

import { getPlayers } from "./roster";

export const ROUND_MS = 3 * 60_000;
export const COUNTDOWN_MS = 3_000;
export const KEYS_TOTAL = 3;
export const COIN_COUNT = 32;
export const GOLD = { coin: 1, key: 5, chest: 10 };

let state = {
  phase: "lobby", // lobby | countdown | hunt | unlocked | ended
  round: 0, // bumped per round: the scene re-scatters coins and keys
  startsAt: 0, // Date.now() the hunt starts (end of countdown)
  endsAt: 0, // Date.now() the moon sets
  keysFound: 0,
  scores: {}, // playerId -> {gold, keys, coins}
  result: null, // {reason: "chest" | "time", openerId, ranking}
  toast: null, // {key, text, color}: last notable event, for the HUD
};
const listeners = new Set();
let toastKey = 0;

function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export const game = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => state,
};

export const getGame = () => state;
export const isRunning = (s = state) => s.phase === "hunt" || s.phase === "unlocked";

export function scoreOf(playerId, s = state) {
  return s.scores[playerId] ?? { gold: 0, keys: 0, coins: 0 };
}

/** Present players, best first. */
export function ranking(s = state) {
  return getPlayers()
    .map((p) => ({ id: p.id, name: p.name, color: p.color, ...scoreOf(p.id, s) }))
    .sort((a, b) => b.gold - a.gold || b.keys - a.keys || a.name.localeCompare(b.name));
}

export function rankOf(playerId, s = state) {
  return ranking(s).findIndex((r) => r.id === playerId) + 1;
}

export function objective(s = state) {
  switch (s.phase) {
    case "lobby":
      return "Press Start to begin the hunt";
    case "countdown":
      return "Get ready…";
    case "hunt":
      return `Sweep your torch through the dark to find the hidden keys (${s.keysFound}/${KEYS_TOTAL})`;
    case "unlocked":
      return "The chest is unlocked! Race to the crossroads!";
    case "ended": {
      const top = s.result?.ranking?.[0];
      return top ? `${top.name} wins with ${top.gold} gold` : "The hunt is over";
    }
    default:
      return "";
  }
}

const toast = (text, color = "#ffd36e") => ({ key: ++toastKey, text, color });

export function startRound() {
  if (state.phase === "countdown" || isRunning()) return;
  const now = Date.now();
  emit({
    phase: "countdown",
    round: state.round + 1,
    startsAt: now + COUNTDOWN_MS,
    endsAt: now + COUNTDOWN_MS + ROUND_MS,
    keysFound: 0,
    scores: {},
    result: null,
    toast: toast("The hunt begins!"),
  });
}

/** Back to free roaming (e.g. everyone left). */
export function resetToLobby() {
  emit({ phase: "lobby", keysFound: 0, result: null, toast: null });
}

/** Called by the scene every frame. */
export function tickGame(now = Date.now()) {
  if (state.phase === "countdown" && now >= state.startsAt) emit({ phase: "hunt" });
  else if (isRunning() && now >= state.endsAt) endRound("time", null);
}

function addGold(playerId, kind) {
  const s = scoreOf(playerId);
  return {
    ...state.scores,
    [playerId]: {
      gold: s.gold + GOLD[kind],
      keys: s.keys + (kind === "key" ? 1 : 0),
      coins: s.coins + (kind === "coin" ? 1 : 0),
    },
  };
}

export function collectCoin(playerId) {
  if (!isRunning()) return;
  emit({ scores: addGold(playerId, "coin") });
}

export function collectKey(player) {
  if (state.phase !== "hunt") return;
  const keysFound = state.keysFound + 1;
  const unlocked = keysFound >= KEYS_TOTAL;
  emit({
    scores: addGold(player.id, "key"),
    keysFound,
    phase: unlocked ? "unlocked" : "hunt",
    toast: unlocked
      ? toast(`${player.name} found the last key: the chest is open for the taking!`, player.color)
      : toast(`${player.name} found a key (${keysFound}/${KEYS_TOTAL})`, player.color),
  });
}

export function openChest(player) {
  if (state.phase !== "unlocked") return;
  state = { ...state, scores: addGold(player.id, "chest") };
  endRound("chest", player.id);
}

function endRound(reason, openerId) {
  const rank = ranking();
  const opener = rank.find((r) => r.id === openerId);
  emit({
    phase: "ended",
    result: { reason, openerId, ranking: rank },
    toast: toast(reason === "chest" && opener ? `${opener.name} opened the treasure chest!` : "The moon has set!", opener?.color),
  });
}
