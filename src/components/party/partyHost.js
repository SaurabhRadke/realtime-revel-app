// Glue between the phones (hostSession) and the game state (roster, game,
// chat). Runs on the screen only; started once by HomeScene.
//
// Network budget: every phone message below is de-duplicated per phone, so a
// phone only hears about something when what IT shows would change. The
// round timer travels once as "ends in N ms" and the phone counts down by
// itself.

import { CHARACTERS } from "@/components/scene/characters";
import {
  addPhonePlayer,
  cyclePlayerCharacter,
  getPlayer,
  getPlayerByPeer,
  getPlayers,
  removePhonePlayer,
  renamePlayer,
  roster,
} from "@/components/scene/roster";
import {
  OIL_TOTAL,
  boostLeft,
  dropOil,
  game,
  getGame,
  isCarrying,
  isRunning,
  keySense,
  objective,
  rankOf,
  resetToLobby,
  scoreOf,
  setMode,
  setReady,
  startRound,
  targetsFound,
  targetsTotal,
  teamGold,
} from "@/components/scene/game";
import { chat, forgetPlayer, nearOf, say } from "@/components/scene/chat";
import { NPCS, choose, closeDialog, dialogOf, forgetNpcPlayer, npcNear, npcs, talk } from "@/components/scene/npcs";
import { SHOP } from "@/components/scene/missions";
import { MAX_NAME, cleanText } from "@/lib/connect/protocol";

const lastSent = new Map(); // `${peerId}:${type}` -> JSON

function sendOnce(host, peerId, msg, dedupeKey = msg) {
  const k = `${peerId}:${msg.type}`;
  const json = JSON.stringify(dedupeKey);
  if (lastSent.get(k) === json) return;
  lastSent.set(k, json);
  host.send(peerId, msg);
}

function forgetPeer(peerId) {
  for (const k of [...lastSent.keys()]) if (k.startsWith(`${peerId}:`)) lastSent.delete(k);
}

function syncYou(host, e) {
  const c = CHARACTERS[e.character];
  sendOnce(host, e.peerId, { type: "you", name: e.name, character: c.name, accent: c.accent, color: e.color });
}

function syncGame(host, e, g = getGame()) {
  const s = scoreOf(e.id, g);
  const players = getPlayers().length;
  const boostUntil = g.boosts[e.id] ?? {};
  const base = {
    type: "game",
    mode: g.mode,
    phase: g.phase,
    gold: s.gold,
    keys: s.keys,
    keysFound: targetsFound(g),
    keysTotal: targetsTotal(g),
    oilTotal: OIL_TOTAL,
    carrying: isCarrying(e.id, g),
    team: teamGold(g),
    rank: rankOf(e.id, g),
    players,
    objective: objective(g),
    round: g.round,
    ready: !!g.ready[e.id],
    readyCount: getPlayers().filter((p) => g.ready[p.id]).length,
    boostsKey: Object.keys(SHOP).map((k) => boostUntil[k] ?? 0).join(","),
  };
  if (g.phase === "ended" && g.result) {
    const top = g.result.ranking[0];
    base.result = {
      winner: top?.name ?? null,
      winnerGold: top?.gold ?? 0,
      you: g.result.ranking.findIndex((r) => r.id === e.id) + 1,
      opened: g.result.reason === "chest" || g.result.reason === "lit",
      lit: g.result.reason === "lit",
      stars: g.result.stars ?? 0,
    };
  }
  const now = Date.now();
  const boosts = {};
  for (const k of Object.keys(SHOP)) {
    const left = boostLeft(e.id, k, now, g);
    if (left > 0) boosts[k] = left;
  }
  const timing = {
    endsIn: isRunning(g) ? Math.max(0, g.endsAt - now) : null,
    startsIn: g.phase === "countdown" ? Math.max(0, g.startsAt - now) : null,
    briefingIn: g.phase === "briefing" ? Math.max(0, g.briefingEndsAt - now) : null,
    boosts,
  };
  sendOnce(host, e.peerId, { ...base, ...timing }, base);
}

// Which townsfolk this phone could talk to, and its conversation with them.
function syncNpc(host, e) {
  const id = npcNear(e.id);
  const def = id ? NPCS[id] : null;
  sendOnce(host, e.peerId, { type: "npc", near: def ? { id, name: def.name, role: def.role, color: def.color } : null });
  const d = dialogOf(e.id);
  const msg = d
    ? { type: "dialog", npc: d.npc, name: NPCS[d.npc].name, role: NPCS[d.npc].role, color: NPCS[d.npc].color, key: d.key, text: d.text, options: d.options }
    : { type: "dialog", npc: null };
  sendOnce(host, e.peerId, msg, d ? d.key : null);
}

function syncNear(host, e) {
  const names = nearOf(e.id)
    .map((id) => getPlayer(id)?.name)
    .filter(Boolean);
  sendOnce(host, e.peerId, { type: "near", names });
}

/** Say something as player `e` (from a phone or the screen's chat box). */
export function sendChat(host, e, raw) {
  const res = say(e, raw);
  if (res.error) {
    if (e.peerId) host?.send(e.peerId, { type: "chat:denied", reason: res.error });
    return res;
  }
  for (const id of [e.id, ...res.to]) {
    const to = getPlayer(id);
    if (to?.peerId) host?.send(to.peerId, { type: "chat", from: e.name, color: e.color, text: res.text, self: id === e.id });
  }
  return res;
}

export function startPartyHost(host) {
  const offAction = host.onAction(({ name, peerId, text, arg }) => {
    if (name === "joined") {
      const e = addPhonePlayer(peerId, cleanText(text, MAX_NAME) || "Player");
      if (!e) host.kick(peerId);
      return;
    }
    if (name === "left") {
      const e = getPlayerByPeer(peerId);
      forgetPeer(peerId);
      if (!e) return;
      forgetPlayer(e.id);
      forgetNpcPlayer(e.id);
      dropOil(e.id);
      removePhonePlayer(peerId);
      if (!getPlayers().some((p) => p.peerId) && getGame().phase !== "lobby") resetToLobby();
      return;
    }
    const e = getPlayerByPeer(peerId);
    if (!e) return;
    if (name === "character") cyclePlayerCharacter(e.id);
    else if (name === "rename") renamePlayer(e.id, cleanText(text, MAX_NAME));
    else if (name === "chat") sendChat(host, e, text);
    else if (name === "start" || name === "again") startRound();
    else if (name === "mode") setMode(arg);
    else if (name === "ready") setReady(e.id, true);
    else if (name === "talk") talk(e.id);
    else if (name === "choose") choose(e.id, arg);
    else if (name === "bye") closeDialog(e.id);
  });

  // Someone joined / left / renamed / changed character: everyone's view of
  // "you", rank and player count may have moved.
  const syncAll = () => {
    for (const e of getPlayers()) {
      if (!e.peerId) continue;
      syncYou(host, e);
      syncGame(host, e);
      syncNear(host, e);
      syncNpc(host, e);
    }
  };
  const offRoster = roster.subscribe(syncAll);
  const offGame = game.subscribe(() => {
    const g = getGame();
    for (const e of getPlayers()) if (e.peerId) syncGame(host, e, g);
  });
  const offNpcs = npcs.subscribe(() => {
    for (const e of getPlayers()) if (e.peerId) syncNpc(host, e);
  });
  const offChat = chat.subscribe(() => {
    for (const e of getPlayers()) if (e.peerId) syncNear(host, e);
  });
  const offSense = keySense.subscribe((id) => {
    const e = getPlayer(id);
    if (e?.peerId) sendOnce(host, e.peerId, { type: "sense", level: keySense.get(id) });
  });
  syncAll();

  return () => {
    offSense();
    offAction();
    offRoster();
    offGame();
    offChat();
    offNpcs();
  };
}
