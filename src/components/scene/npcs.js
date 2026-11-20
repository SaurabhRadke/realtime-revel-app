// The townsfolk of Lanternfold and what they say.
//
//   Old Wick       the ghostly lamplighter at the crossroads. Free hints (where
//                  the nearest hidden prize is, in words); in Lamps Out he
//                  takes the oil.
//   Madame Hollow  the seer in the striped tent down the west road. For gold,
//                  a vision: a pillar of light over the nearest hidden prize.
//   Ember          the fox merchant at the cart down the east road. Sells a
//                  compass, torch oil and a swift tonic (game.js boosts).
//
// Walk up to one (TALK_RADIUS) and "Talk" (phone button, or E on the
// keyboard). Every player has their own conversation: the screen shows the
// keyboard player's in a panel, phones show their own; the townsfolk's latest
// line also floats over their head on the big screen.
//
// The scene measures who stands near whom and calls setNpcNear(); the network
// glue (partyHost.js) and the HUD read the snapshot. No three.js here.

import { getPlayer } from "./roster";
import { addBoost, getGame, isCarrying, isRunning, scoreOf, spendGold } from "./game";
import { SHOP, VISION_COST } from "./missions";
import { compassWord, describePlace } from "./townProps";
import { world } from "./world";

export const NPCS = {
  wick: { id: "wick", name: "Old Wick", role: "Lamplighter", color: "#ffd36e", portrait: "/ui/portraits/wick.webp" },
  hollow: { id: "hollow", name: "Madame Hollow", role: "Seer", color: "#c9a4ff", portrait: "/ui/portraits/hollow.webp" },
  ember: { id: "ember", name: "Ember", role: "Merchant", color: "#ff9a5a", portrait: "/ui/portraits/ember.webp" },
};
export const NPC_IDS = Object.keys(NPCS);

const GREETINGS = {
  wick: ["Evening, {name}.", "Mind the dark, {name}.", "Ah, a torch! Good.", "Need a hint, {name}?"],
  hollow: ["I sensed you coming…", "Come closer, {name}…", "The dark whispers your name."],
  ember: ["Psst! Over here!", "Fresh wares, {name}!", "Gold talks, friend."],
};

const FORTUNES = [
  "A cat will judge you before the night is out. It will be right.",
  "The thing you seek is closer than your torch dares to look.",
  "Beware of fireflies that dance alone. Not every light is honest.",
  "You will find gold, lose gold and find it again. Such is life.",
  "Someone near you is about to run very fast in the wrong direction.",
  "The moon is patient. You should not be.",
];

const HINT_COOLDOWN_MS = 12_000;
const SPEECH_MS = 6_000;

let state = {
  near: {}, // playerId -> npcId (who they could talk to)
  dialogs: {}, // playerId -> {npc, key, text, options: [{id, label, cost?, disabled?}]}
  speech: {}, // npcId -> {key, text, until}
};
const listeners = new Set();
const lastHint = new Map();
let seq = 0;

function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export const npcs = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => state,
};

export const npcNear = (playerId) => state.near[playerId] ?? null;
export const dialogOf = (playerId) => state.dialogs[playerId] ?? null;

// The keyboard player is called "You" on the screen: the townsfolk say "traveller".
const nameOf = (player) => (!player || player.name === "You" ? "traveller" : player.name);
const fill = (text, player) => text.replaceAll("{name}", nameOf(player));

/** The townsfolk says something over their head (big screen). */
export function speak(npcId, text) {
  const until = Date.now() + Math.max(SPEECH_MS, text.length * 70);
  const key = ++seq;
  emit({ speech: { ...state.speech, [npcId]: { key, text, until } } });
  setTimeout(() => {
    if (state.speech[npcId]?.key === key) {
      const { [npcId]: _gone, ...rest } = state.speech;
      emit({ speech: rest });
    }
  }, until - Date.now() + 50);
}

// ---------------------------------------------------------------------------
// Conversations: each node is {text, options}; choosing an option runs it.
// ---------------------------------------------------------------------------

const BYE = { id: "bye", label: "Goodbye" };

function wickNode(player) {
  const g = getGame();
  const lamps = g.mode === "lamps";
  if (g.phase === "lobby" || g.phase === "ended") {
    return {
      text: lamps
        ? `Evening, ${nameOf(player)}. Every lamp in town is about to go dark… Press Start and I'll tell you what needs doing.`
        : `Evening, ${nameOf(player)}. The chest at the crossroads is restless tonight. Press Start and I'll tell you all about it.`,
      options: [{ id: "who", label: "Who are you?" }, { id: "town", label: "Who else is about?" }, BYE],
    };
  }
  if (g.phase === "briefing" || g.phase === "countdown") {
    return { text: "Not long now. When the bell rings, follow the fireflies!", options: [BYE] };
  }
  if (g.phase === "unlocked") {
    return {
      text: lamps ? "Look at that glow! Now open the chest, all of you, quick!" : "The chest is unlocked! What are you doing talking to me? Run!",
      options: [BYE],
    };
  }
  if (lamps) {
    const left = 5 - g.oil.delivered;
    return {
      text: isCarrying(player.id)
        ? "Is that oil? Bless you! Just bring it right here to me."
        : `${left} flask${left === 1 ? "" : "s"} still out in the dark. My old bones can't carry them, I'm mostly fog these days.`,
      options: [{ id: "hint", label: "Any idea where one is?" }, BYE],
    };
  }
  return {
    text: `Keys, is it? ${3 - g.keysFound} still out there. The fireflies never lie… well, mostly.`,
    options: [{ id: "hint", label: "Any hints, Wick?" }, BYE],
  };
}

function hollowNode(player) {
  const running = isRunning();
  const gold = scoreOf(player.id).gold;
  return {
    text: running
      ? `Cross my palm with ${VISION_COST} gold, ${nameOf(player)}, and the dark will show you what it hides…`
      : `The night has not begun, ${nameOf(player)}. Come back when the hunt is on… or let me read your fortune.`,
    options: [
      {
        id: "vision",
        label: `See a vision`,
        cost: VISION_COST,
        disabled: !running || gold < VISION_COST,
        note: !running ? "during the hunt" : gold < VISION_COST ? `you have ${gold}` : null,
      },
      { id: "fortune", label: "Read my fortune (free)" },
      BYE,
    ],
  };
}

function emberNode(player, lead) {
  const running = isRunning();
  const gold = scoreOf(player.id).gold;
  return {
    text:
      lead ??
      (running
        ? "Finest wares on the east road! Gold only, no refunds, no questions."
        : "Shop opens when the hunt does, friend. Come back with gold in your pocket."),
    options: [
      ...Object.entries(SHOP).map(([id, item]) => ({
        id: `buy:${id}`,
        label: item.label,
        cost: item.cost,
        disabled: !running || gold < item.cost,
        note: !running ? "during the hunt" : gold < item.cost ? `you have ${gold}` : `${item.secs}s`,
      })),
      BYE,
    ],
  };
}

function rootNode(npcId, player) {
  if (npcId === "wick") return wickNode(player);
  if (npcId === "hollow") return hollowNode(player);
  return emberNode(player);
}

function setDialog(playerId, npcId, node) {
  const d = { npc: npcId, key: ++seq, text: node.text, options: node.options };
  emit({ dialogs: { ...state.dialogs, [playerId]: d } });
  speak(npcId, node.text);
}

export function closeDialog(playerId) {
  if (!state.dialogs[playerId]) return;
  const { [playerId]: _gone, ...rest } = state.dialogs;
  emit({ dialogs: rest });
}

/** "Talk" pressed: start (or restart) a conversation with whoever is near. */
export function talk(playerId) {
  const npcId = state.near[playerId];
  const player = getPlayer(playerId);
  if (!npcId || !player) return false;
  setDialog(playerId, npcId, rootNode(npcId, player));
  return true;
}

function hintText(player) {
  const t = world.nearestTarget(player.id);
  if (!t) return "Nothing left out there to find. Off to the chest with you!";
  const dir = compassWord(t.x - t.fromX, t.z - t.fromZ);
  const paces = Math.max(5, Math.round(t.dist / 5) * 5);
  const { landmark, distance } = describePlace(t.x, t.z);
  const what = t.kind === "oil" ? "a flask glinting" : "fireflies dancing";
  const place = distance < 14 ? `, not far from ${landmark}` : "";
  return `I saw ${what} to the ${dir} of here, about ${paces} paces off${place}.`;
}

/** An option was picked. */
export function choose(playerId, optionId) {
  const d = state.dialogs[playerId];
  const player = getPlayer(playerId);
  if (!d || !player) return;
  const opt = d.options.find((o) => o.id === optionId);
  if (!opt || opt.disabled) return;
  const back = (text, extra = []) => ({ text, options: [...extra, { id: "back", label: "Something else…" }, BYE] });

  if (optionId === "bye") {
    const farewell = { wick: "Keep your torch high.", hollow: "We shall meet again…", ember: "Come back with more gold!" }[d.npc];
    speak(d.npc, farewell);
    closeDialog(playerId);
    return;
  }
  if (optionId === "back") {
    setDialog(playerId, d.npc, rootNode(d.npc, player));
    return;
  }

  if (d.npc === "wick") {
    if (optionId === "who") {
      setDialog(playerId, "wick", back("I'm Wick. I've lit these lamps for three hundred years, give or take. Dying didn't seem a good reason to stop."));
    } else if (optionId === "town") {
      setDialog(
        playerId,
        "wick",
        back("Madame Hollow reads the dark in her tent down the west road, for a price. Ember the fox sells odds and ends from a cart to the east. Bring gold."),
      );
    } else if (optionId === "hint") {
      const now = Date.now();
      const wait = HINT_COOLDOWN_MS - (now - (lastHint.get(playerId) ?? 0));
      if (wait > 0) {
        setDialog(playerId, "wick", back(`Give an old ghost a moment to think… ask me again in ${Math.ceil(wait / 1000)} seconds.`));
      } else {
        lastHint.set(playerId, now);
        setDialog(playerId, "wick", back(hintText(player)));
      }
    }
    return;
  }

  if (d.npc === "hollow") {
    if (optionId === "fortune") {
      const f = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
      setDialog(playerId, "hollow", back(f));
    } else if (optionId === "vision") {
      if (!isRunning() || !world.nearestTarget(playerId)) {
        setDialog(playerId, "hollow", back("The dark is empty tonight. There is nothing left for me to see."));
      } else if (spendGold(playerId, VISION_COST)) {
        world.castVision(playerId);
        setDialog(playerId, "hollow", back("I see it… there! A pillar of light burns over it. Hurry, it will not last!"));
      }
    }
    return;
  }

  if (d.npc === "ember" && optionId.startsWith("buy:")) {
    const item = SHOP[optionId.slice(4)];
    if (item && isRunning() && spendGold(playerId, item.cost)) {
      addBoost(playerId, optionId.slice(4), item.secs);
      setDialog(playerId, "ember", emberNode(player, `Pleasure doing business! ${item.blurb} Anything else?`));
    }
  }
}

/** Scene -> here: who stands within talking range of whom (already with hysteresis). */
export function setNpcNear(next) {
  const prev = state.near;
  const ids = new Set([...Object.keys(prev), ...Object.keys(next)]);
  let changed = false;
  for (const id of ids) {
    if (prev[id] === next[id]) continue;
    changed = true;
    // Walked up: the townsfolk notices. Walked off: the conversation ends.
    if (next[id] && !prev[id]) {
      const lines = GREETINGS[next[id]];
      if (!state.dialogs[id] && !state.speech[next[id]]) speak(next[id], fill(lines[Math.floor(Math.random() * lines.length)], getPlayer(id)));
    }
    if (state.dialogs[id] && state.dialogs[id].npc !== next[id]) closeDialog(id);
  }
  if (changed) emit({ near: next });
}

/** A player left: forget them. */
export function forgetNpcPlayer(playerId) {
  closeDialog(playerId);
  if (state.near[playerId]) {
    const { [playerId]: _gone, ...rest } = state.near;
    emit({ near: rest });
  }
  lastHint.delete(playerId);
}

/** Wick, when someone hands him oil (the scene calls this). */
export function wickThanks(player, left) {
  const lines =
    left > 0
      ? [`Lovely! ${left} more and the whole town shines again.`, `Ah, ${nameOf(player)}, bless you. ${left} to go!`, `Oil! The lamps are flickering back. ${left} left.`]
      : ["That's the lot! Look at her glow! To the chest, quick!"];
  speak("wick", lines[Math.floor(Math.random() * lines.length)]);
}
