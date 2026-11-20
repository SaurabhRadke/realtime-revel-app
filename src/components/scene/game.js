// The rules of a round, for both ways to play (missions.js):
//
// "The Three Keys" (hunt, everyone for themselves)
//   1. Gold coins are scattered through the town: walk over them (+1 gold).
//   2. Three old keys are hidden in the dark, off the lamp-lit roads. A key
//      only shows itself when a torch beam (or someone standing right next
//      to it) lights it up. Clues: fireflies swarm around every key (and
//      around a few decoy spots too), and each player's "key sense" meter
//      runs from cold to burning as they get closer to one. +5 gold.
//   3. With all three keys found the treasure chest at the crossroads
//      unlocks. The first to reach it opens it (+10 gold) and ends the round.
//   4. If the moon sets first (the timer), the round ends where it stands.
//   Most gold wins.
//
// "Lamps Out" (lamps, one team)
//   The street lamps are out. Five oil flasks are hidden like the keys. Walk
//   over one to carry it (one each), bring it to Old Wick at the crossroads
//   (+3 gold): every flask relights part of the town. With all five in, the
//   chest unlocks; opening it wins the round for everyone, with up to three
//   stars for time to spare.
//
// Before every round a briefing explains the mission; it ends when every
// player pressed Ready (or after a minute), then a short countdown starts.
//
// Gold is also money: the townsfolk (npcs.js) sell hints and boosts.
//
// Item positions live in the scene (it knows the town layout); this module
// keeps the rules, scores and phase, and notifies the UI on every change.
// No three.js here.

import { getPlayers } from "./roster";
import { BRIEFING_MS, DEFAULT_MODE, MODES } from "./missions";

export const COUNTDOWN_MS = 3_000;
export const KEYS_TOTAL = 3;
export const OIL_TOTAL = 5;
export const COIN_COUNT = 32;
export const GOLD = { coin: 1, key: 5, chest: 10, oil: 3, lit: 5 };

let state = {
  mode: DEFAULT_MODE, // hunt | lamps
  phase: "lobby", // lobby | briefing | countdown | hunt | unlocked | ended
  round: 0, // bumped per round: the scene re-scatters coins and keys
  briefingEndsAt: 0,
  ready: {}, // playerId -> true, during the briefing
  startsAt: 0, // Date.now() the hunt starts (end of countdown)
  endsAt: 0, // Date.now() the moon sets
  keysFound: 0,
  oil: { delivered: 0, carriers: {} }, // lamps: carriers = playerId -> true
  scores: {}, // playerId -> {gold, keys, coins, oil}
  boosts: {}, // playerId -> {compass, oil, swift}: Date.now() each one runs out
  result: null, // {reason: "chest" | "time" | "lit", openerId, ranking, stars}
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
export const roundMs = (mode = state.mode) => MODES[mode].minutes * 60_000;
/** Hidden prizes this round: keys or oil flasks. */
export const targetsTotal = (s = state) => (s.mode === "lamps" ? OIL_TOTAL : KEYS_TOTAL);
export const targetsFound = (s = state) => (s.mode === "lamps" ? s.oil.delivered : s.keysFound);

export function scoreOf(playerId, s = state) {
  return s.scores[playerId] ?? { gold: 0, keys: 0, coins: 0, oil: 0 };
}

/** Present players, best first. */
export function ranking(s = state) {
  return getPlayers()
    .map((p) => ({ id: p.id, name: p.name, color: p.color, ...scoreOf(p.id, s) }))
    .sort((a, b) => b.gold - a.gold || b.keys + b.oil - (a.keys + a.oil) || a.name.localeCompare(b.name));
}

export function rankOf(playerId, s = state) {
  return ranking(s).findIndex((r) => r.id === playerId) + 1;
}

export const teamGold = (s = state) => getPlayers().reduce((n, p) => n + scoreOf(p.id, s).gold, 0);

export const isCarrying = (playerId, s = state) => !!s.oil.carriers[playerId];

/** 0..1: how lit the street lamps are (Lamps Out turns them off, oil brings them back). */
export function lampLevel(s = state) {
  if (s.mode !== "lamps" || s.phase === "lobby") return 1;
  if (s.phase === "ended" && s.result?.reason === "lit") return 1;
  if (s.phase === "unlocked") return 1;
  return s.oil.delivered / OIL_TOTAL;
}

export function objective(s = state) {
  const lamps = s.mode === "lamps";
  switch (s.phase) {
    case "lobby":
      return lamps ? "Lamps Out: press Start to hear the mission" : "The Three Keys: press Start to hear the mission";
    case "briefing":
      return "Listen to the mission, then press Ready";
    case "countdown":
      return "Get ready…";
    case "hunt":
      return lamps
        ? `Find the oil flasks in the dark and carry them to Old Wick (${s.oil.delivered}/${OIL_TOTAL} delivered)`
        : `Follow the fireflies and light them with your torch: find the hidden keys (${s.keysFound}/${KEYS_TOTAL})`;
    case "unlocked":
      return lamps ? "Lanternfold is lit again! Open the chest at the crossroads together" : "The chest is unlocked! Race to the crossroads!";
    case "ended": {
      if (lamps) {
        return s.result?.reason === "lit"
          ? `The town is saved: ${"★".repeat(s.result.stars)}${"☆".repeat(3 - s.result.stars)}`
          : `The moon set with ${s.oil.delivered}/${OIL_TOTAL} flasks delivered`;
      }
      const top = s.result?.ranking?.[0];
      return top ? `${top.name} wins with ${top.gold} gold` : "The hunt is over";
    }
    default:
      return "";
  }
}

const toast = (text, color = "#ffd36e") => ({ key: ++toastKey, text, color });

/** Lobby / results: pick how to play. */
export function setMode(mode) {
  if (!MODES[mode] || mode === state.mode) return;
  if (state.phase !== "lobby" && state.phase !== "ended") return;
  emit({ mode, phase: "lobby", result: null, toast: toast(`Mode: ${MODES[mode].title}`) });
}

/** Start pressed: the briefing comes first. */
export function startRound() {
  if (state.phase !== "lobby" && state.phase !== "ended") return;
  emit({
    phase: "briefing",
    briefingEndsAt: Date.now() + BRIEFING_MS,
    ready: {},
    result: null,
    toast: null,
  });
}

/** Skip the rest of the briefing (or it timed out, or everyone is ready). */
export function beginCountdown() {
  if (state.phase !== "briefing") return;
  const now = Date.now();
  emit({
    phase: "countdown",
    round: state.round + 1,
    startsAt: now + COUNTDOWN_MS,
    endsAt: now + COUNTDOWN_MS + roundMs(),
    keysFound: 0,
    oil: { delivered: 0, carriers: {} },
    scores: {},
    boosts: {},
    result: null,
    toast: toast(state.mode === "lamps" ? "Find the oil!" : "The hunt begins!"),
  });
}

export function setReady(playerId, on = true) {
  if (state.phase !== "briefing" || !!state.ready[playerId] === on) return;
  const ready = { ...state.ready };
  if (on) ready[playerId] = true;
  else delete ready[playerId];
  emit({ ready });
  const players = getPlayers();
  if (players.length && players.every((p) => ready[p.id])) beginCountdown();
}

/** Back to free roaming (e.g. everyone left). */
export function resetToLobby() {
  emit({ phase: "lobby", keysFound: 0, oil: { delivered: 0, carriers: {} }, boosts: {}, ready: {}, result: null, toast: null });
}

/** Called by the scene every frame. */
export function tickGame(now = Date.now()) {
  if (state.phase === "briefing" && now >= state.briefingEndsAt) beginCountdown();
  else if (state.phase === "countdown" && now >= state.startsAt) emit({ phase: "hunt" });
  else if (isRunning() && now >= state.endsAt) endRound("time", null);
}

function addGold(playerId, kind, scores = state.scores) {
  const s = scores[playerId] ?? { gold: 0, keys: 0, coins: 0, oil: 0 };
  return {
    ...scores,
    [playerId]: {
      ...s,
      gold: s.gold + GOLD[kind],
      keys: s.keys + (kind === "key" ? 1 : 0),
      coins: s.coins + (kind === "coin" ? 1 : 0),
      oil: s.oil + (kind === "oil" ? 1 : 0),
    },
  };
}

export function collectCoin(playerId) {
  if (!isRunning()) return;
  emit({ scores: addGold(playerId, "coin") });
}

export function collectKey(player) {
  if (state.mode !== "hunt" || state.phase !== "hunt") return;
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

/** Lamps Out: pick up a flask. False if already carrying one. */
export function pickOil(player) {
  if (state.mode !== "lamps" || state.phase !== "hunt" || state.oil.carriers[player.id]) return false;
  emit({
    oil: { ...state.oil, carriers: { ...state.oil.carriers, [player.id]: true } },
    toast: toast(`${player.name} found a flask of oil: take it to Old Wick!`, player.color),
  });
  return true;
}

/** A carrier left (or the round ended): the flask drops. */
export function dropOil(playerId) {
  if (!state.oil.carriers[playerId]) return;
  const { [playerId]: _gone, ...carriers } = state.oil.carriers;
  emit({ oil: { ...state.oil, carriers } });
}

export function deliverOil(player) {
  if (state.mode !== "lamps" || !state.oil.carriers[player.id]) return false;
  const { [player.id]: _gone, ...carriers } = state.oil.carriers;
  const delivered = state.oil.delivered + 1;
  const done = delivered >= OIL_TOTAL;
  emit({
    oil: { delivered, carriers },
    scores: addGold(player.id, "oil"),
    phase: done ? "unlocked" : state.phase,
    toast: done
      ? toast("Every lamp is burning again! The chest at the crossroads is open", player.color)
      : toast(`${player.name} brought oil: ${delivered}/${OIL_TOTAL} lamps relit`, player.color),
  });
  return true;
}

export function openChest(player) {
  if (state.phase !== "unlocked") return;
  if (state.mode === "lamps") {
    // A team win: everyone gets the bonus, the opener the chest's gold too.
    let scores = addGold(player.id, "chest");
    for (const p of getPlayers()) scores = addGold(p.id, "lit", scores);
    state = { ...state, scores };
    endRound("lit", player.id);
    return;
  }
  state = { ...state, scores: addGold(player.id, "chest") };
  endRound("chest", player.id);
}

function endRound(reason, openerId) {
  const rank = ranking();
  const opener = rank.find((r) => r.id === openerId);
  const left = Math.max(0, state.endsAt - Date.now());
  const stars = reason === "lit" ? (left >= 90_000 ? 3 : left >= 30_000 ? 2 : 1) : 0;
  const text =
    reason === "lit"
      ? `${opener?.name ?? "The team"} opened the chest: Lanternfold is saved!`
      : reason === "chest" && opener
        ? `${opener.name} opened the treasure chest!`
        : "The moon has set!";
  emit({
    phase: "ended",
    oil: { ...state.oil, carriers: {} },
    result: { reason, openerId, ranking: rank, stars, timeLeft: left, mode: state.mode },
    toast: toast(text, opener?.color),
  });
}

// ---- Gold as money, timed boosts ----

/** Pay `cost` gold. False if the player can't afford it. */
export function spendGold(playerId, cost) {
  const s = scoreOf(playerId);
  if (s.gold < cost) return false;
  emit({ scores: { ...state.scores, [playerId]: { ...s, gold: s.gold - cost } } });
  return true;
}

export function addBoost(playerId, kind, secs) {
  const now = Date.now();
  const mine = state.boosts[playerId] ?? {};
  const until = Math.max(now, mine[kind] ?? 0) + secs * 1000;
  emit({ boosts: { ...state.boosts, [playerId]: { ...mine, [kind]: until } } });
}

export function boostLeft(playerId, kind, now = Date.now(), s = state) {
  return Math.max(0, (s.boosts[playerId]?.[kind] ?? 0) - now);
}

// ---- Key sense: per player, how close the nearest hidden prize is ----
// 0 cold .. 4 burning. Written by the scene a few times a second; listeners
// only hear about actual changes (the phones get one tiny message per step).
export const SENSE_LEVELS = 5;
const senseLevels = new Map();
const senseListeners = new Set();

export const keySense = {
  subscribe(fn) {
    senseListeners.add(fn);
    return () => senseListeners.delete(fn);
  },
  get: (playerId) => senseLevels.get(playerId) ?? 0,
};

export function setKeySense(playerId, level) {
  if ((senseLevels.get(playerId) ?? 0) === level) return;
  senseLevels.set(playerId, level);
  for (const fn of senseListeners) fn(playerId);
}
