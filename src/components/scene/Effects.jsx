"use client";

import {
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  Noise,
  Sepia,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";

// Vintage film grade. All of these are merged into a single full-screen pass
// by postprocessing, so the cost is roughly one extra texture blit.
export default function Effects({ multisampling }) {
  return (
    <EffectComposer multisampling={multisampling} stencilBuffer={false}>
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={-0.22} />
      <Sepia intensity={0.3} />
      <BrightnessContrast brightness={0.02} contrast={0.08} />
      <Vignette offset={0.28} darkness={0.65} />
      <Noise premultiply opacity={0.45} blendFunction={BlendFunction.SCREEN} />
    </EffectComposer>
  );
}
