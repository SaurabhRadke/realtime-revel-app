// Builds distance LODs (lighter copies) of the houses and the street lamp.
//
//   node scripts/build-lods.mjs
//
// Reads the web-ready models in public/models/ (the full-detail version stays
// untouched and is still what you see up close) and writes, for each one,
// public/models/lod/<name>.lod1.glb .. lod3.glb plus
// src/components/scene/lodModels.json.
//
// Each level is simplified to a fixed maximum geometric error (stored in the
// manifest in model units). At runtime the town switches to a level only once
// the camera is far enough away that this error is under ONE screen pixel, so
// the swap is not visible.
//
// LOD files hold geometry only: at runtime they reuse the full model's
// material and textures, so nothing is downloaded or uploaded twice.
// Geometry is meshopt-compressed (EXT_meshopt_compression, decoded by drei's
// useGLTF).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compactPrimitive, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const MODELS_JSON = "src/components/scene/sceneModels.json";
const OUT = "public/models/lod";
const MANIFEST = "src/components/scene/lodModels.json";
// Maximum error per level, relative to the model's size (meshopt's scale).
const LEVEL_ERRORS = [0.002, 0.004, 0.008];
// Normals + UVs count towards the error too, so shading and texture mapping
// hold up (not just the silhouette).
const ATTRIBUTE_WEIGHTS = [0.5, 0.5, 0.5, 1, 1];

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
MeshoptSimplifier.useExperimentalFeatures = true; // simplifyWithAttributes

const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const targets = JSON.parse(readFileSync(MODELS_JSON, "utf8")).filter((m) => m.kind === "house" || m.kind === "lamp");

mkdirSync(OUT, { recursive: true });
const manifest = {};

for (const { url } of targets) {
  const src = join("public", url);
  const name = basename(url, ".glb");
  const levels = [];

  for (const [i, rel] of LEVEL_ERRORS.entries()) {
    const doc = await io.read(src);
    const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    let worst = 0;
    let tris = 0;
    let before = 0;
    for (const prim of prims) {
      const pos = prim.getAttribute("POSITION").getArray();
      const nrm = prim.getAttribute("NORMAL")?.getArray();
      const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
      const n = pos.length / 3;
      const attrs = new Float32Array(n * 5);
      for (let v = 0; v < n; v++) {
        if (nrm) attrs.set(nrm.subarray(v * 3, v * 3 + 3), v * 5);
        if (uv) attrs.set(uv.subarray(v * 2, v * 2 + 2), v * 5 + 3);
      }
      const indices = new Uint32Array(prim.getIndices().getArray());
      before += indices.length / 3;
      const [out, err] = MeshoptSimplifier.simplifyWithAttributes(
        indices, pos, 3, attrs, 5, ATTRIBUTE_WEIGHTS, null, 0, rel, [],
      );
      const scale = MeshoptSimplifier.getScale(pos, 3);
      worst = Math.max(worst, err * scale); // model units
      tris += out.length / 3;
      prim.getIndices().setArray(out);
      compactPrimitive(prim);
    }

    // Geometry only: the runtime reuses the full model's material.
    for (const tex of doc.getRoot().listTextures()) tex.dispose();
    for (const mat of doc.getRoot().listMaterials()) mat.dispose();
    for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose(); // webp, specular: no longer used
    // Quantized: positions to 14 bits (well under a millimetre on a house),
    // UVs kept in 0..1 (same texture space as the full model) at 14 bits.
    await doc.transform(
      prune({ keepAttributes: true }),
      meshopt({ encoder: MeshoptEncoder, level: "medium", quantizeTexcoord: 14 }),
    );

    const file = join(OUT, `${name}.lod${i + 1}.glb`);
    await io.write(file, doc);
    levels.push({ url: "/" + file.replace(/^public\//, ""), error: Number(worst.toPrecision(4)), tris });
    console.log(`${name} lod${i + 1}: ${before} -> ${tris} tris, error ${worst.toFixed(5)}, ${(statSync(file).size / 1024).toFixed(0)}KB`);
  }
  manifest[url] = levels;
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${MANIFEST}`);
