"use client";

import { useEffect, useMemo } from "react";
import { MUD_VERGE, ROAD_HALF_LENGTH, ROAD_WIDTH } from "./config";
import {
  MUD_TILE_METRES,
  STONE_TILE_METRES,
  createEdgeMask,
  createMudTextures,
  createStoneTextures,
} from "./roadTextures";

const ROAD_LENGTH = ROAD_HALF_LENGTH * 2;
const MUD_WIDTH = ROAD_WIDTH + MUD_VERGE * 2;

// One layer of a street (mud verge or stone surface), lying along local Z.
// The ragged alpha mask is cut with alphaTest (no transparency sorting cost).
function Layer({ width, textures, mask, rotationY, y, offset }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, rotationY]} position={[0, y, 0]}>
      <planeGeometry args={[width, ROAD_LENGTH]} />
      <meshLambertMaterial
        map={textures.map}
        bumpMap={textures.bumpMap}
        bumpScale={textures.bumpScale}
        alphaMap={mask}
        alphaTest={0.5}
        polygonOffset
        polygonOffsetFactor={-offset}
        polygonOffsetUnits={-offset}
      />
    </mesh>
  );
}

export default function Road() {
  const res = useMemo(() => {
    const stone = createStoneTextures(1024);
    const mud = createMudTextures(512);
    stone.bumpScale = 4; // pronounced domes on the rounded stones
    mud.bumpScale = 1.2;
    for (const t of [stone.map, stone.bumpMap]) {
      t.repeat.set(ROAD_WIDTH / STONE_TILE_METRES, ROAD_LENGTH / STONE_TILE_METRES);
    }
    for (const t of [mud.map, mud.bumpMap]) {
      t.repeat.set(MUD_WIDTH / MUD_TILE_METRES, ROAD_LENGTH / MUD_TILE_METRES);
    }
    // Each street layer gets its own ragged edge so nothing repeats.
    const masks = {
      mainMud: createEdgeMask({ seed: 1, ragged: 0.24, bites: 0.08 }),
      mainStone: createEdgeMask({ seed: 2, ragged: 0.3, bites: 0.18, holes: 0.42 }),
      crossMud: createEdgeMask({ seed: 3, ragged: 0.24, bites: 0.08 }),
      crossStone: createEdgeMask({ seed: 4, ragged: 0.3, bites: 0.18, holes: 0.42 }),
    };
    return { stone, mud, masks };
  }, []);

  useEffect(
    () => () => {
      const { stone, mud, masks } = res;
      [stone.map, stone.bumpMap, mud.map, mud.bumpMap, ...Object.values(masks)].forEach((t) =>
        t.dispose(),
      );
    },
    [res],
  );

  const { stone, mud, masks } = res;
  const cross = Math.PI / 2;

  return (
    <group>
      {/* Mud verges underneath, then the stone surfaces on top. */}
      <Layer width={MUD_WIDTH} textures={mud} mask={masks.mainMud} rotationY={0} y={0.01} offset={1} />
      <Layer width={MUD_WIDTH} textures={mud} mask={masks.crossMud} rotationY={cross} y={0.014} offset={2} />
      <Layer width={ROAD_WIDTH} textures={stone} mask={masks.mainStone} rotationY={0} y={0.018} offset={3} />
      <Layer width={ROAD_WIDTH} textures={stone} mask={masks.crossStone} rotationY={cross} y={0.022} offset={4} />
    </group>
  );
}
