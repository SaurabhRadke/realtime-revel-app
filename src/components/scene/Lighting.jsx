"use client";

import { HEMI_INTENSITY, PALETTE, SUN_INTENSITY, SUN_POSITION, FOG_FAR, FOG_NEAR } from "./config";

// Golden-hour lighting: warm low sun + earthy hemisphere fill + warm haze.
// No shadow maps — the grass fakes its own occlusion, which keeps this cheap.
export default function Lighting() {
  return (
    <>
      <fog attach="fog" args={[PALETTE.fog, FOG_NEAR, FOG_FAR]} />
      <hemisphereLight args={[PALETTE.hemiSky, PALETTE.hemiGround, HEMI_INTENSITY]} />
      <directionalLight position={SUN_POSITION} color={PALETTE.sun} intensity={SUN_INTENSITY} />
    </>
  );
}
