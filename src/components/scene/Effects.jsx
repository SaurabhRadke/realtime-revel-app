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

// Night grade: a touch of the old-film look (desaturated, faint warmth, soft
// vignette, fine grain) but light enough that the darks stay deep and blue.
// All of these are merged into a single full-screen pass by postprocessing,
// so the cost is roughly one extra texture blit.
export default function Effects({ multisampling }) {
  return (
    <EffectComposer multisampling={multisampling} stencilBuffer={false}>
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={-0.12} />
      <Sepia intensity={0.08} />
      <BrightnessContrast brightness={0} contrast={0.06} />
      <Vignette offset={0.3} darkness={0.7} />
      <Noise premultiply opacity={0.16} blendFunction={BlendFunction.SCREEN} />
    </EffectComposer>
  );
}
