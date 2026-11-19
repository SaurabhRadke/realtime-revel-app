"use client";

import { HEMI_INTENSITY, PALETTE, MOON_INTENSITY, MOON_POSITION, FOG_FAR, FOG_NEAR } from "./config";

// Moonlit night: cool moon key light + dim blue sky fill + dark haze.
// No shadow maps — the grass fakes its own occlusion, which keeps this cheap.
export default function Lighting() {
  return (
    <>
      <fog attach="fog" args={[PALETTE.fog, FOG_NEAR, FOG_FAR]} />
      <hemisphereLight args={[PALETTE.hemiSky, PALETTE.hemiGround, HEMI_INTENSITY]} />
      <directionalLight position={MOON_POSITION} color={PALETTE.moon} intensity={MOON_INTENSITY} />
    </>
  );
}
