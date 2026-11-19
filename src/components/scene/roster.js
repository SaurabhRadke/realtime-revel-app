// Who is playing: one entry per character in the town.
//
// With no phone connected there is a single local player, driven by the
// keyboard. The first phone to join adopts that character (so a solo phone
// player keeps the familiar first/third-person view); every further phone
// gets a character of its own. When the last phone leaves, the character
// falls back to the keyboard.
//
// No three.js here: the DOM overlay and the network glue read it too.

import { CHARACTERS, DEFAULT_CHARACTER } from "./characters";

export const MAX_PLAYERS = 4;

// One colour per slot: name tags, chat lines, scoreboard.
export const SLOT_COLORS = ["#ffd36e", "#8fd8ff", "#ff9ec4", "#a8f0a0"];

const LOCAL_NAME = "You";

let nextId = 1;
let entries = [makeEntry("p0", null, LOCAL_NAME, DEFAULT_CHARACTER, 0)];
const listeners = new Set();

function makeEntry(id, peerId, name, character, slot) {
  return { id, peerId, name, character, slot, color: SLOT_COLORS[slot] };
}

function emit(next) {
  entries = next;
  for (const fn of listeners) fn();
}

export const roster = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => entries,
};

export const getPlayers = () => entries;
export const getPlayer = (id) => entries.find((e) => e.id === id);
export const getPlayerByPeer = (peerId) => entries.find((e) => e.peerId === peerId);
/** True while several people share the screen (party camera, chat, keyboard types). */
export const isParty = () => entries.length > 1;

function freeSlot() {
  for (let s = 0; s < MAX_PLAYERS; s++) if (!entries.some((e) => e.slot === s)) return s;
  return -1;
}

// Random character nobody else is wearing (any, if all four are taken).
function randomCharacter(exceptId) {
  const used = new Set(entries.filter((e) => e.id !== exceptId).map((e) => e.character));
  const free = CHARACTERS.map((_, i) => i).filter((i) => !used.has(i));
  const pool = free.length ? free : CHARACTERS.map((_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}

// "Pip" twice in the room becomes "Pip" and "Pip 2".
function uniqueName(name, exceptId) {
  const taken = new Set(entries.filter((e) => e.id !== exceptId).map((e) => e.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, 13)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** A phone joined. Returns its player entry (null if the screen is full). */
export function addPhonePlayer(peerId, name) {
  const existing = getPlayerByPeer(peerId);
  if (existing) return existing;

  const solo = entries.length === 1 && entries[0].peerId === null ? entries[0] : null;
  if (solo) {
    const adopted = { ...solo, peerId, name: uniqueName(name, solo.id), character: randomCharacter(solo.id) };
    emit([adopted]);
    return adopted;
  }
  const slot = freeSlot();
  if (slot < 0) return null;
  const entry = makeEntry(`p${nextId++}`, peerId, uniqueName(name, null), randomCharacter(null), slot);
  emit([...entries, entry]);
  return entry;
}

/** A phone left: its character goes too, unless it is the last one standing. */
export function removePhonePlayer(peerId) {
  const entry = getPlayerByPeer(peerId);
  if (!entry) return;
  if (entries.length === 1) {
    emit([{ ...entry, peerId: null, name: LOCAL_NAME }]);
  } else {
    emit(entries.filter((e) => e !== entry));
  }
}

export function renamePlayer(id, name) {
  const entry = getPlayer(id);
  if (!entry || !name) return null;
  const next = { ...entry, name: uniqueName(name, id) };
  emit(entries.map((e) => (e === entry ? next : e)));
  return next;
}

export function setPlayerCharacter(id, character) {
  const entry = getPlayer(id);
  if (!entry || entry.character === character) return entry;
  const next = { ...entry, character };
  emit(entries.map((e) => (e === entry ? next : e)));
  return next;
}

/** Next character along that nobody else is wearing (wraps; any if all taken). */
export function cyclePlayerCharacter(id) {
  const entry = getPlayer(id);
  if (!entry) return null;
  const used = new Set(entries.filter((e) => e.id !== id).map((e) => e.character));
  let c = entry.character;
  for (let i = 0; i < CHARACTERS.length; i++) {
    c = (c + 1) % CHARACTERS.length;
    if (!used.has(c)) break;
  }
  return setPlayerCharacter(id, c);
}
