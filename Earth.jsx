import React, { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Sphere, useTexture } from "@react-three/drei";
import * as THREE from "three";

function EarthModel() {
  const earthRef = useRef();

  const texture = useTexture(
    "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg"
  );

  useFrame(() => {
    if (earthRef.current) {
      earthRef.current.rotation.y += 0.0018;
    }
  });

  return (
    <group>
      {/* Earth */}
      <Sphere
        ref={earthRef}
        args={[1.55, 96, 96]}
        scale={1}
      >
        <meshStandardMaterial
          map={texture}
          roughness={0.82}
          metalness={0.05}
        />
      </Sphere>

      {/* Atmosphere */}
      <Sphere args={[1.62, 96, 96]}>
        <meshBasicMaterial
          color="#20d9ff"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </Sphere>

      {/* Soft outer glow */}
      <Sphere args={[1.70, 64, 64]}>
        <meshBasicMaterial
          color="#00cfff"
          transparent
          opacity={0.035}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </Sphere>
    </group>
  );
}

export default function Earth() {
  return (
    <div className="earth-container">
      <Canvas
        camera={{
          position: [0, 0, 5.2],
          fov: 42,
        }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.45} />

        <directionalLight
          position={[4, 2, 5]}
          intensity={2.2}
        />

        <pointLight
          position={[-4, -2, 3]}
          color="#00d9ff"
          intensity={1.2}
        />

        <EarthModel />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          enableRotate={false}
        />
      </Canvas>
    </div>
  );
}