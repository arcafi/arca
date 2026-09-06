"use client";

/* The Arca vault — a metallic box with a candlestick through it, on a starfield.
   Idles, tilts toward the cursor, and spins as you scroll. Built with
   react-three-fiber so React lifecycle / StrictMode / the render loop are handled
   for us. Imported with ssr:false (three.js can't SSR). */

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
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

function VaultGroup({ reduce }: { reduce: boolean }) {
  const group = useRef<THREE.Group>(null);
  const input = useInput();
  const boxGeo = useMemo(() => new THREE.BoxGeometry(2.5, 2.5, 2.5), []);
  const edgeGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);

  useFrame((s) => {
    const g = group.current;
    if (!g) return;
    const st = input.current;
    st.mx += (st.tmx - st.mx) * 0.06;
    st.my += (st.tmy - st.my) * 0.06;
    const t = s.clock.elapsedTime;
    const idle = reduce ? 0 : t * 0.35;
    g.rotation.y = idle + st.scrollP * Math.PI * 1.4 + st.mx * 0.5;
    g.rotation.x = -0.16 + (reduce ? 0 : Math.sin(t * 0.6) * 0.05) + st.my * 0.35 + st.scrollP * 0.25;
    s.camera.position.z = 8.4 - st.scrollP * 1.2;
  });

  return (
    <group ref={group}>
      {/* the vault */}
      <mesh geometry={boxGeo}>
        <meshStandardMaterial color="#9aa869" metalness={0.5} roughness={0.32} />
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial color="#efe7d8" transparent opacity={0.5} />
        </lineSegments>
      </mesh>
      {/* lid seam */}
      <mesh position={[0, 1.28, 0]}>
        <boxGeometry args={[2.62, 0.14, 2.62]} />
        <meshStandardMaterial color="#8b9a5c" metalness={0.5} roughness={0.3} />
      </mesh>
      {/* candlestick body */}
      <mesh position={[0.15, 0.1, 1.35]}>
        <boxGeometry args={[0.62, 3.0, 0.62]} />
        <meshStandardMaterial color="#cfe08a" metalness={0.4} roughness={0.3} emissive="#7a9a2e" emissiveIntensity={0.6} />
      </mesh>
      {/* wick */}
      <mesh position={[0.15, 0.1, 1.35]}>
        <cylinderGeometry args={[0.045, 0.045, 4.4, 12]} />
        <meshStandardMaterial color="#dfe8bf" metalness={0.4} roughness={0.3} />
      </mesh>
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

export function VaultCanvas() {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      <Canvas camera={{ position: [0, 0.2, 8.4], fov: 38 }} gl={{ alpha: true, antialias: true }} dpr={[1, 2]}>
        <ambientLight intensity={0.85} color="#ece3d0" />
        <directionalLight intensity={3.0} color="#fff4dc" position={[4, 6, 6]} />
        <pointLight intensity={3.2} color="#9fc06a" position={[-6, -1, 4]} distance={40} />
        <pointLight intensity={0.8} color="#bfd0ff" position={[3, -4, -2]} distance={40} />
        <VaultGroup reduce={reduce} />
        <Stars />
      </Canvas>
    </div>
  );
}
