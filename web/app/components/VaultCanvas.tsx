"use client";

/* The Arca vault — an OPEN strongbox (the logo mark in 3D): four walls + floor,
   two lid flaps thrown open, cream edge-lines, and the index glowing inside as a
   candlestick. Idles, tilts to the cursor, spins on scroll. r3f, ssr:false. */

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

type Input = { mx: number; my: number; tmx: number; tmy: number; scrollP: number };

function useInput() {
  const state = useRef<Input>({ mx: 0, my: 0, tmx: 0, tmy: 0, scrollP: 0 });
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      state.current.tmx = (e.clientX / window.innerWidth - 0.5) * 2;
      state.current.tmy = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const onScroll = () => {
      state.current.scrollP = Math.max(0, Math.min(1, window.scrollY / (window.innerHeight * 1.1)));
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return state;
}

/* one metal panel + its cream edge lines (the logo's line quality) */
function Panel({
  size,
  position,
  rotation,
  color = "#7c8a49",
}: {
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
}) {
  const geo = useMemo(() => new THREE.BoxGeometry(size[0], size[1], size[2]), [size]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  return (
    <mesh geometry={geo} position={position} rotation={rotation}>
      <meshStandardMaterial color={color} metalness={0.55} roughness={0.34} />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#e7dfcf" transparent opacity={0.4} />
      </lineSegments>
    </mesh>
  );
}

function Vault({ reduce }: { reduce: boolean }) {
  const group = useRef<THREE.Group>(null);
  const input = useInput();
  const S = 2.4; // inner box size
  const T = 0.16; // wall thickness
  const h = S / 2;

  useFrame((s) => {
    const g = group.current;
    if (!g) return;
    const st = input.current;
    st.mx += (st.tmx - st.mx) * 0.06;
    st.my += (st.tmy - st.my) * 0.06;
    const t = s.clock.elapsedTime;
    const idle = reduce ? 0 : t * 0.32;
    g.rotation.y = idle + st.scrollP * Math.PI * 1.4 + st.mx * 0.5;
    g.rotation.x = -0.12 + (reduce ? 0 : Math.sin(t * 0.6) * 0.05) + st.my * 0.32 + st.scrollP * 0.25;
    s.camera.position.z = 9 - st.scrollP * 1.2;
  });

  return (
    <group ref={group} position={[0, -0.15, 0]}>
      {/* box body — floor + 4 walls, open top */}
      <Panel size={[S + T, T, S + T]} position={[0, -h, 0]} />
      <Panel size={[S + T, S, T]} position={[0, 0, -h]} />
      <Panel size={[S + T, S, T]} position={[0, 0, h]} />
      <Panel size={[T, S, S + T]} position={[-h, 0, 0]} />
      <Panel size={[T, S, S + T]} position={[h, 0, 0]} />

      {/* two lids thrown open (hinged at the top front/back edges) */}
      <group position={[0, h, -h]} rotation={[-1.18, 0, 0]}>
        <Panel size={[S + T, T, S * 0.7]} position={[0, 0, -S * 0.35]} color="#93a35c" />
      </group>
      <group position={[0, h, h]} rotation={[1.18, 0, 0]}>
        <Panel size={[S + T, T, S * 0.7]} position={[0, 0, S * 0.35]} color="#93a35c" />
      </group>

      {/* the index, glowing inside the open vault */}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[0.5, 2.3, 0.5]} />
        <meshStandardMaterial color="#d4e28c" metalness={0.3} roughness={0.3} emissive="#8fb03a" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 3.2, 10]} />
        <meshStandardMaterial color="#eef3d2" metalness={0.3} roughness={0.3} emissive="#8fb03a" emissiveIntensity={0.5} />
      </mesh>
      <pointLight position={[0, 0.6, 0]} intensity={2.2} distance={6} color="#c8e06a" />
    </group>
  );
}

function Stars() {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const N = 340;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 2] = -6 - Math.random() * 24;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y += 0.0006;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#cfe0a0" size={0.14} transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

function Scene({ children }: { children: ReactNode }) {
  return (
    <Canvas camera={{ position: [0, 0.2, 9], fov: 38 }} gl={{ alpha: true, antialias: true }} dpr={[1, 2]}>
      <ambientLight intensity={0.75} color="#ece3d0" />
      <directionalLight intensity={3.0} color="#fff4dc" position={[4, 6, 6]} />
      <pointLight intensity={2.8} color="#9fc06a" position={[-6, -1, 4]} distance={40} />
      <pointLight intensity={0.7} color="#bfd0ff" position={[3, -4, -2]} distance={40} />
      {children}
    </Canvas>
  );
}

export function VaultCanvas() {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      <Scene>
        <Vault reduce={reduce} />
        <Stars />
      </Scene>
    </div>
  );
}
