import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { FIELD_RADIUS } from "./config";
import { mulberry32 } from "./utils";

/**
 * Paints the round turf (base colour, uneven mottling, fine grain) into ONE
 * canvas texture. No image downloads. The grass shader samples this same
 * texture, so blades inherit the same patchy colour variation.
 *
 * Canvas (px, py) maps to world (x, z):  x = R * (2px/size - 1),  z = R * (2py/size - 1)
 */
export function createGroundTexture(size = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(1937);

  const ppm = size / (FIELD_RADIUS * 2); // pixels per metre
  const M = (m) => m * ppm;
  const c = size / 2;

  // 1) Base turf
  ctx.fillStyle = "#5a6830";
  ctx.fillRect(0, 0, size, size);

  // 2) Mottled, uneven growth: soft blotches of yellowed and deep-green grass
  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = M(2 + rand() * 8);
    const dry = rand() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dry ? "rgba(172,152,74,0.24)" : "rgba(38,60,22,0.26)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 3) Fine grain so the turf never looks flat from up close
  for (let i = 0; i < 40000; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * c;
    const s = 1 + rand() * 2;
    ctx.fillStyle = i % 2 ? "rgba(30,40,12,0.28)" : "rgba(190,175,100,0.16)";
    ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, s, s);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}
