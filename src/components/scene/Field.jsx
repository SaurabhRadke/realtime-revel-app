"use client";

import { useEffect, useMemo } from "react";
import { DoubleSide } from "three";
import { FIELD_RADIUS } from "./config";
import { createGroundTexture } from "./groundTexture";
import Grass from "./Grass";

export default function Field({ bladeCount }) {
  const groundMap = useMemo(() => createGroundTexture(1024), []);
  useEffect(() => () => groundMap.dispose(), [groundMap]);

  return (
    <group>
      {/* Round turf disc. Tinted darker than the blades so the gaps between
          them read as shaded soil/thatch -> the grass looks thicker. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[FIELD_RADIUS, 128]} />
        <meshLambertMaterial map={groundMap} color="#a3a292" />
      </mesh>

      {/* Low weathered perimeter wall */}
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[FIELD_RADIUS + 0.15, FIELD_RADIUS + 0.15, 0.7, 128, 1, true]} />
        <meshLambertMaterial color="#cdbf9f" side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[FIELD_RADIUS + 0.05, FIELD_RADIUS + 0.35, 128]} />
        <meshLambertMaterial color="#b3a37f" />
      </mesh>

      {/* Surrounding dry land fading into fog */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <ringGeometry args={[FIELD_RADIUS + 0.1, 420, 96]} />
        <meshLambertMaterial color="#8a7a50" />
      </mesh>

      <Grass groundMap={groundMap} count={bladeCount} />
    </group>
  );
}
