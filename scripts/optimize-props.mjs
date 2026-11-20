// Shrinks the NPC + prop GLBs in 3d-assets/game-assets/ for the web and writes
// them to public/models/props/:
//
//   - welds and simplifies the meshes (several of the source scans are 500k
//     triangles: far too heavy for a phone-hosted party game)
//   - re-encodes the textures as WebP at a sensible size (via ffmpeg)
//   - writes src/components/scene/propModels.json: each model's URL, id and
//     upright size, so the town can be planned before anything downloads
//
//   node scripts/optimize-props.mjs
//
// Needs ffmpeg (with libwebp) on PATH and the gltf-transform + meshoptimizer
// dev dependencies.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld, getBounds } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const SRC = "3d-assets/game-assets";
const OUT = "public/models/props";
const MANIFEST = "src/components/scene/propModels.json";

// id, source file, triangle budget, base-colour texture size, other maps size
const MODELS = [
  { id: "fortune-teller", file: "Fortune Teller.glb", tris: 16000, base: 1024, other: 512 },
  { id: "lamplighter", file: "lamp-lighter.glb", tris: 16000, base: 1024, other: 512 },
  { id: "cat", file: "cat that can walk.glb", tris: 7000, base: 1024, other: 512 },
  { id: "tent", file: "fortune-teller tent.glb", tris: 14000, base: 1024, other: 512 },
  { id: "well", file: "well.glb", tris: 12000, base: 1024, other: 512 },
  { id: "barrels", file: "barrels.glb", tris: 9000, base: 1024, other: 512 },
  { id: "flag", file: "flag.glb", tris: 5000, base: 1024, other: 512 },
  { id: "jar", file: "JAR.glb", tris: 5000, base: 512, other: 256 },
  { id: "compass", file: "compass.glb", tris: 9000, base: 512, other: 256 },
  { id: "campfire", file: "campfire.glb", tris: 8000, base: 512, other: 256 },
  { id: "cart", file: "market cart.glb", tris: 0 },
  { id: "bench", file: "bench.glb", tris: 0 },
];

function toWebp(data, size, tmp, name) {
  const inFile = join(tmp, `${name}.in`);
  const outFile = join(tmp, `${name}.webp`);
  writeFileSync(inFile, data);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", inFile,
    "-vf", `scale='min(${size},iw)':-2:flags=lanczos`,
    "-c:v", "libwebp", "-quality", "80", "-compression_level", "6",
    outFile,
  ]);
  return readFileSync(outFile);
}

function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += (idx ? idx.getCount() : p.getAttribute("POSITION").getCount()) / 3;
    }
  }
  return Math.round(n);
}

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "props-"));
const manifest = [];

try {
  for (const m of MODELS) {
    const src = join(SRC, m.file);
    const doc = await io.read(src);
    const before = triangleCount(doc);

    await doc.transform(dedup(), weld());
    if (m.tris && before > m.tris) {
      const ratio = m.tris / before;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: false }));
      // Scans with lots of tiny islands can refuse to go lower at that error: loosen it.
      if (triangleCount(doc) > m.tris * 1.6) {
        await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: m.tris / triangleCount(doc), error: 0.02, lockBorder: false }));
      }
    }

    // Textures -> WebP. Base colour stays sharper than the data maps.
    const baseTex = new Set(doc.getRoot().listMaterials().map((mat) => mat.getBaseColorTexture()).filter(Boolean));
    let webp = false;
    doc.getRoot().listTextures().forEach((tex, i) => {
      const img = tex.getImage();
      if (!img || !m.base) return;
      const size = baseTex.has(tex) ? m.base : m.other;
      tex.setImage(toWebp(Buffer.from(img), size, tmp, `${m.id}-${i}`));
      tex.setMimeType("image/webp");
      tex.setURI(`${m.id}-${i}.webp`);
      webp = true;
    });
    if (webp) doc.createExtension(EXTTextureWebP).setRequired(true);
    await doc.transform(prune());

    const out = join(OUT, `${m.id}.glb`);
    await io.write(out, doc);

    // Upright (Y-up, world) size with every node transform applied.
    const box = getBounds(doc.getRoot().getDefaultScene());
    const r = (n) => Math.round(n * 1e4) / 1e4;
    manifest.push({
      id: m.id,
      url: "/" + out.replace(/^public\//, ""),
      width: r(box.max[0] - box.min[0]),
      height: r(box.max[1] - box.min[1]),
      depth: r(box.max[2] - box.min[2]),
    });
    const mb = (f) => (statSync(f).size / 1e6).toFixed(1);
    console.log(`${m.file} -> ${out}  ${before} -> ${triangleCount(doc)} tris, ${mb(src)}MB -> ${mb(out)}MB`);
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${MANIFEST}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
