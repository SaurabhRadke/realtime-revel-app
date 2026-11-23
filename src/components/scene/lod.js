// Distance LODs for the houses and street lamps (built by scripts/build-lods.mjs).
//
// Quality rule: a lighter level is only used once the camera is far enough
// away that its geometric error is smaller than ONE screen pixel, so the swap
// cannot be seen. The pixel size depends on the real render height (window
// size x device pixel ratio) and the camera's field of view, and is updated
// live by <LodView>.
//
// The LOD files are only geometry; they reuse the full model's material and
// textures. They download in the background once the town is on screen
// (startLodLoading); until then everything simply draws at full detail.

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import LOD_MODELS from "./lodModels.json";

export const HYSTERESIS = 0.05; // stay on a level 5% longer, so it never flickers

/** LOD levels available for a model URL: [{ url, error }] (error in model units). */
export const lodLevelsFor = (url) => LOD_MODELS[url] ?? null;

// ---- Screen-pixel size ----------------------------------------------------

// Size of one pixel at 1 m from the camera (metres). Start pessimistic (a
// tall 4K-class render) so nothing coarsens too early before <LodView> runs.
let pixelAtOneMetre = (2 * Math.tan((60 / 2) * (Math.PI / 180))) / 2160;
const listeners = new Set();

/** Called by <LodView> when the render height or field of view changes. */
export function setLodView(fovDeg, heightPx) {
  const next = (2 * Math.tan((fovDeg / 2) * (Math.PI / 180))) / Math.max(1, heightPx);
  if (Math.abs(next - pixelAtOneMetre) / pixelAtOneMetre < 0.01) return;
  pixelAtOneMetre = next;
  for (const fn of listeners) fn();
}

/** Re-run `fn` whenever the pixel size changes. Returns an unsubscribe. */
export function onLodViewChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Camera distance (to the object's centre) from which a level with this
 * world-space error may be used. `radius` covers the object's own size, so
 * even its nearest corner is far enough away.
 */
export function switchDistance(worldError, radius) {
  return (worldError / pixelAtOneMetre + radius) / (1 - HYSTERESIS);
}

// ---- Background loading -----------------------------------------------------

let openGate;
const gate = new Promise((resolve) => {
  openGate = resolve;
});

/** The town is on screen: start fetching the LOD files. */
export function startLodLoading() {
  openGate();
}

let loader = null;
const cache = new Map();

/**
 * Resolves (after startLodLoading) to the model's lighter levels:
 * [{ geometry, matrix, error }], where `matrix` is the mesh's transform inside
 * its file (rotation + de-quantization). Resolves to [] if anything fails, so
 * the model just stays at full detail.
 */
export function loadLodLevels(url) {
  const levels = lodLevelsFor(url);
  if (!levels) return Promise.resolve([]);
  if (!cache.has(url)) {
    const job = gate
      .then(() => {
        if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
        return Promise.all(levels.map((l) => loader.loadAsync(l.url)));
      })
      .then((files) =>
        files.map((gltf, i) => {
          gltf.scene.updateMatrixWorld(true);
          let mesh = null;
          gltf.scene.traverse((o) => {
            if (o.isMesh && !mesh) mesh = o;
          });
          return { geometry: mesh.geometry, matrix: mesh.matrixWorld.clone(), error: levels[i].error };
        }),
      )
      .catch((err) => {
        console.warn(`LOD load failed for ${url}; keeping full detail`, err);
        return [];
      });
    cache.set(url, job);
  }
  return cache.get(url);
}
