// The two ways to play, and everything the briefing says about them. Shared by
// the big screen (GameHud) and the phones (Controller), so both show the same
// words. No three.js here.

export const MODES = {
  hunt: {
    id: "hunt",
    title: "The Three Keys",
    kind: "Everyone for themselves",
    players: "1–4 players",
    minutes: 3,
    tagline: "Light up three hidden keys, then race to the chest.",
    story:
      "When the moon rises over Lanternfold, the old chest at the crossroads stirs. Its three keys lie hidden in the dark between the houses, and they only show themselves in torchlight.",
    goals: [
      { icon: "coin", text: "Grab gold coins along the roads and through the grass." },
      { icon: "wisp", text: "Follow the fireflies and sweep your torch over the dark to reveal a key." },
      { icon: "key", text: "Find all three keys: each one is worth 5 gold." },
      { icon: "chest", text: "Then race to the chest at the crossroads. Opening it ends the hunt." },
    ],
    win: "Most gold when the chest opens (or the moon sets) wins.",
  },
  lamps: {
    id: "lamps",
    title: "Lamps Out",
    kind: "Work together",
    players: "1–4 players, one team",
    minutes: 4,
    tagline: "Bring the lamplighter his oil and light up the town again.",
    story:
      "A cold wind blew out every lamp in Lanternfold. Old Wick, the lamplighter, can't relight them: his five flasks of lamp oil rolled off into the dark.",
    goals: [
      { icon: "wisp", text: "Five oil flasks are hidden in the dark. Fireflies circle each one." },
      { icon: "torch", text: "Your torch reveals them. Walk over a flask to pick it up (one at a time)." },
      { icon: "oil", text: "Carry it to Old Wick at the crossroads. Every flask relights part of the town." },
      { icon: "chest", text: "Light the whole town, then open the chest together before the moon sets." },
    ],
    win: "One team: earn up to three stars by finishing with time to spare.",
  },
};

export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE = "hunt";

/** The townsfolk, as the briefing introduces them. */
export const TOWNSFOLK = [
  { id: "wick", name: "Old Wick", where: "at the crossroads", does: "free hints (and he takes the oil)" },
  { id: "hollow", name: "Madame Hollow", where: "in the tent down the west road", does: "visions that reveal a hidden prize, for gold" },
  { id: "ember", name: "Ember", where: "at the cart down the east road", does: "a compass, torch oil and a swift tonic" },
];

export const BRIEFING_MS = 60_000; // auto-start if not everyone pressed Ready by then

export const SHOP = {
  compass: { label: "Brass compass", cost: 4, secs: 25, blurb: "Floats over your head, pointing at the nearest hidden prize." },
  oil: { label: "Torch oil", cost: 2, secs: 40, blurb: "Your torch burns brighter and reaches much further." },
  swift: { label: "Swift tonic", cost: 3, secs: 20, blurb: "Run much faster for a little while." },
};
export const VISION_COST = 3;
export const VISION_SECS = 12;
