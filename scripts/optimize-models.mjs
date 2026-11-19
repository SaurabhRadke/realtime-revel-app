// Shrinks the GLBs (houses, street lamp, moon, torch, and characters in
// 3d-assets/character/) in 3d-assets/ for the web by re-encoding their 4K
// PNG textures as smaller WebP (via ffmpeg) and writing the result to
// public/models/. Geometry is copied untouched.
//
//   node scripts/optimize-models.mjs
//
// Also writes src/components/scene/sceneModels.json: each model's URL, kind
// ("character" for files in character/, else "lamp" / "moon" / "torch" if the
// file name says so, else "house") and its
// size once stood upright (Y-up), so the random layout can be planned before
// any model has downloaded.
//
// Needs ffmpeg built with libwebp on PATH.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const SRC = "3d-assets";
const OUT = "public/models";
const BASE_COLOR_SIZE = 2048;
const OTHER_SIZE = 1024; // normal + metal/rough maps
const QUALITY = 82;
const MANIFEST = "src/components/scene/sceneModels.json";

const align4 = (n) => (n + 3) & ~3;

function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binStart);
  const bin = buf.subarray(binStart + 8, binStart + 8 + binLen);
  return { json, bin };
}

function writeGlb(file, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = Buffer.alloc(align4(jsonBuf.length) - jsonBuf.length, 0x20);
  const binPad = Buffer.alloc(align4(bin.length) - bin.length, 0);
  const jsonChunk = Buffer.concat([jsonBuf, jsonPad]);
  const binChunk = Buffer.concat([bin, binPad]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const ch = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  writeFileSync(
    file,
    Buffer.concat([header, ch(jsonChunk.length, 0x4e4f534a), jsonChunk, ch(binChunk.length, 0x004e4942), binChunk]),
  );
}

function toWebp(data, size, tmp, name) {
  const inFile = join(tmp, `${name}.in`);
  const outFile = join(tmp, `${name}.webp`);
  writeFileSync(inFile, data);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", inFile,
    "-vf", `scale='min(${size},iw)':-2:flags=lanczos`,
    "-c:v", "libwebp", "-quality", String(QUALITY), "-compression_level", "6",
    outFile,
  ]);
  return readFileSync(outFile);
}

// Upright size of the model: every source file is a single Z-up mesh under a
// root node rotated +90deg about X, so local x/y/z -> world width/depth/height.
function measure(json) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const acc = json.accessors[prim.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], acc.min[i]);
        max[i] = Math.max(max[i], acc.max[i]);
      }
    }
  }
  const r = (n) => Math.round(n * 1e4) / 1e4;
  return { width: r(max[0] - min[0]), depth: r(max[1] - min[1]), height: r(max[2] - min[2]) };
}

function optimize(srcFile, outFile, tmp) {
  const { json, bin } = readGlb(srcFile);
  const size = measure(json);

  // Which image is the base colour (kept sharper than the data maps)?
  const baseColorImages = new Set();
  for (const m of json.materials ?? []) {
    const t = m.pbrMetallicRoughness?.baseColorTexture;
    if (t) baseColorImages.add(json.textures[t.index].source ?? json.textures[t.index].extensions?.EXT_texture_webp?.source);
  }

  const replaced = new Map(); // bufferView index -> new bytes
  (json.images ?? []).forEach((img, i) => {
    const view = json.bufferViews[img.bufferView];
    const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const size = baseColorImages.has(i) ? BASE_COLOR_SIZE : OTHER_SIZE;
    replaced.set(img.bufferView, toWebp(data, size, tmp, `img${i}`));
    img.mimeType = "image/webp";
  });

  // Point textures at the WebP images through EXT_texture_webp.
  for (const tex of json.textures ?? []) {
    const source = tex.source ?? tex.extensions?.EXT_texture_webp?.source;
    delete tex.source;
    tex.extensions = { ...tex.extensions, EXT_texture_webp: { source } };
  }
  if (json.images?.length) {
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "EXT_texture_webp"])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), "EXT_texture_webp"])];
  }

  // Repack every buffer view into a fresh binary chunk.
  const parts = [];
  let offset = 0;
  json.bufferViews.forEach((view, i) => {
    const data =
      replaced.get(i) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const pad = align4(offset) - offset;
    if (pad) parts.push(Buffer.alloc(pad));
    offset += pad;
    view.byteOffset = offset;
    view.byteLength = data.length;
    parts.push(data);
    offset += data.length;
  });
  const newBin = Buffer.concat(parts);
  json.buffers = [{ byteLength: newBin.length }];
  writeGlb(outFile, json, newBin);
  return size;
}

mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "houses-"));
const models = [];
try {
  // Top-level files, plus the characters in their own sub-folder.
  const sources = [
    ...readdirSync(SRC).filter((f) => f.endsWith(".glb")).map((f) => ({ f, dir: SRC, character: false })),
    ...readdirSync(join(SRC, "character"))
      .filter((f) => f.endsWith(".glb"))
      .map((f) => ({ f, dir: join(SRC, "character"), character: true })),
  ].sort((a, b) => a.f.localeCompare(b.f));
  for (const { f, dir, character } of sources) {
    const name = basename(f).replace(/^(pixellabs|jerryblessed)-/, "").replace(/-\d+\.glb$/, ".glb");
    const out = join(OUT, character ? "characters" : "", name);
    mkdirSync(join(OUT, character ? "characters" : ""), { recursive: true });
    const size = optimize(join(dir, f), out, tmp);
    const kind = character
      ? "character"
      : /lamp/i.test(f)
        ? "lamp"
        : /moon/i.test(f)
          ? "moon"
          : /torch/i.test(f)
            ? "torch"
            : "house";
    models.push({ url: "/" + out.replace(/^public\//, ""), kind, ...size });
    const before = readFileSync(join(dir, f)).length / 1e6;
    const after = readFileSync(out).length / 1e6;
    console.log(`${f} -> ${out}  ${before.toFixed(1)}MB -> ${after.toFixed(1)}MB`);
  }
  writeFileSync(MANIFEST, JSON.stringify(models, null, 2) + "\n");
  console.log(`wrote ${MANIFEST}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
