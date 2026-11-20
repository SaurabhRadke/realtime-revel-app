// Questions only the 3D scene can answer, asked by the rules and the
// townsfolk (npcs.js). The scene (Treasure.jsx) fills these in once it is
// mounted; until then they answer "nothing". No three.js here, so the DOM
// overlay can import the modules that use it without pulling in 3D code.

export const world = {
  /** (playerId) => {x, z, dist, kind} of the nearest hidden prize still out there, or null. */
  nearestTarget: () => null,
  /** (playerId) => true if a vision now shows a hidden prize to everyone. */
  castVision: () => false,
};
