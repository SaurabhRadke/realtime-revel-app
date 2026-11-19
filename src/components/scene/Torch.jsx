"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { AdditiveBlending, Color, ConeGeometry, DoubleSide, Quaternion, ShaderMaterial, Vector3 } from "three";
import { player } from "./player";
import SCENE_MODELS from "./sceneModels.json";
import { TORCH, torchUniforms } from "./torchLight";

const TORCH_URL = SCENE_MODELS.find((m) => m.kind === "torch")?.url;
if (TORCH_URL) useGLTF.preload(TORCH_URL, false);

// The model is a real-size flashlight (~25 cm), lens at its -Z end. It sits
// in a holder rotated so the lens faces +Z: then Object3D.lookAt() points it.
const TORCH_SCALE = 1.5;
// The handle's middle sits at model z = +0.04 (lens end is -z); shift it so
// the hand point holds the handle, not the middle of the torch.
const GRIP_SHIFT = 0.04 * TORCH_SCALE;
const LENS_Z = 0.108 * TORCH_SCALE + GRIP_SHIFT + 0.01;
// First person: held low and to the right of the view, like a game viewmodel.
const VIEWMODEL_OFFSET = new Vector3(0.24, -0.27, -0.5);
const BEAM_LENGTH = 1; // unit cone, scaled to the distance to the aim point

const _fppPos = new Vector3();
const _pos = new Vector3();
const _lens = new Vector3();
const _dir = new Vector3();
const _bob = new Vector3();
const _q = new Quaternion();

const beamVertex = /* glsl */ `
  varying float vAlong;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vAlong = position.z; // 0 at the lens .. 1 at the far end
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// Faint light scattered by night air: bright near the lens, fading out along
// the beam and towards the cone's silhouette edges.
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlong;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vView)));
    float a = pow(1.0 - vAlong, 1.8) * pow(facing, 1.4) * uOpacity;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

function createBeamGeometry() {
  // Open cone with its apex at the origin, opening along +Z to length 1.
  const r = Math.tan(TORCH.angle) * BEAM_LENGTH;
  const g = new ConeGeometry(r, BEAM_LENGTH, 40, 8, true);
  g.rotateX(-Math.PI / 2); // apex now at -Z/2
  g.translate(0, 0, BEAM_LENGTH / 2); // apex at origin
  return g;
}

function stepTorch(state, dt, refs) {
  const { holder, beam, spot, target, glow } = refs;
  const h = holder.current;
  if (!h) return;
  const cam = state.camera;
  const e = player.camBlend * player.camBlend * (3 - 2 * player.camBlend);

  // First-person pose: fixed in the camera's frame, swaying with each step.
  const moving = Math.min(1, player.speed / 3);
  _bob.set(
    Math.sin(player.walkPhase) * 0.018 * moving,
    -Math.abs(Math.cos(player.walkPhase)) * 0.022 * moving,
    0,
  );
  _fppPos.copy(VIEWMODEL_OFFSET).add(_bob).applyQuaternion(cam.quaternion).add(cam.position);

  // Third-person pose: in the character's hand.
  _pos.lerpVectors(_fppPos, player.hand, e);
  h.position.copy(_pos);
  h.lookAt(player.aim);
  const s = Math.max(0.0001, player.torchScale);
  h.scale.setScalar(s);
  h.visible = player.torchScale > 0.01;

  // Light leaves from the lens towards the aim point.
  _lens.set(0, 0, LENS_Z * s);
  h.localToWorld(_lens);
  _dir.subVectors(player.aim, _lens);
  const dist = _dir.length();
  _dir.divideScalar(dist || 1);

  const on = player.torchScale;
  const flicker = 1 + Math.sin(state.clock.elapsedTime * 23) * 0.01; // LED driver hum
  if (spot.current && target.current) {
    spot.current.position.copy(_lens);
    target.current.position.copy(player.aim);
    target.current.updateMatrixWorld();
    spot.current.intensity = TORCH.intensity * on * flicker;
  }
  if (glow.current) glow.current.intensity = 0.9 * on;

  torchUniforms.uTorchPos.value.copy(_lens);
  torchUniforms.uTorchDir.value.copy(_dir);
  torchUniforms.uTorchColor.value.set(TORCH.color).multiplyScalar(TORCH.intensity * on * flicker);

  // Beam: from the lens, stretched to (a little past) whatever it hits.
  const b = beam.current;
  if (b) {
    const len = Math.min(16, dist + 1.5);
    b.position.copy(_lens);
    _q.copy(h.quaternion);
    b.quaternion.copy(_q);
    b.scale.set(len, len, len);
    // Fainter in first person, where the beam starts right in your face.
    b.material.uniforms.uOpacity.value = (0.06 + 0.07 * e) * on;
    b.visible = on > 0.01;
  }
}

export default function Torch() {
  const { scene } = useGLTF(TORCH_URL, false);
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material.clone();
      // Without an environment map, metal renders black: keep some sheen.
      if (m.metalness > 0.4) m.metalness = 0.35;
      if (m.name === "Torch_LightGlow") {
        m.color = new Color("#fff1c4");
        m.emissive = new Color(TORCH.color);
        m.emissiveIntensity = 6;
      }
      o.material = m;
    });
    return root;
  }, [scene]);
  useEffect(
    () => () =>
      model.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      }),
    [model],
  );

  const beamRes = useMemo(
    () => ({
      geometry: createBeamGeometry(),
      material: new ShaderMaterial({
        uniforms: { uColor: { value: new Color(TORCH.color) }, uOpacity: { value: 0 } },
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      beamRes.geometry.dispose();
      beamRes.material.dispose();
    },
    [beamRes],
  );

  const holder = useRef(null);
  const beam = useRef(null);
  const spot = useRef(null);
  const target = useRef(null);
  const glow = useRef(null);

  useEffect(() => {
    if (spot.current && target.current) spot.current.target = target.current;
  }, []);

  useFrame((state, dt) => stepTorch(state, dt, { holder, beam, spot, target, glow }), -1);

  return (
    <>
      <group ref={holder}>
        <group position={[0, 0, GRIP_SHIFT]} rotation={[0, Math.PI, 0]} scale={TORCH_SCALE}>
          <primitive object={model} />
        </group>
        {/* Warm spill around the lens: lights the hand and nearby ground. */}
        <pointLight ref={glow} position={[0, 0, LENS_Z + 0.05]} color={TORCH.color} distance={3.5} decay={2} />
      </group>
      <mesh
        ref={beam}
        geometry={beamRes.geometry}
        material={beamRes.material}
        renderOrder={6}
        frustumCulled={false}
      />
      <spotLight
        ref={spot}
        color={TORCH.color}
        angle={TORCH.angle}
        penumbra={TORCH.penumbra}
        decay={TORCH.decay}
        distance={TORCH.distance}
        intensity={0}
      />
      <object3D ref={target} />
    </>
  );
}
