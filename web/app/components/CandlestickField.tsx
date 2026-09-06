"use client";

/* Phase 2 — the scroll fly-through. A field of candlestick "buildings" (instanced
   bars) you fly through as you scroll a tall pinned section, à la the reference.
   Self-contained: renders its own section + sticky canvas + overlay. r3f, ssr:false. */

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const COUNT = 240;

function Field({ progress }: { progress: { current: number } }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(0.7, 1, 0.7), []);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.35, roughness: 0.5 }),
    [],
  );

  const bars = useMemo(() => {
    const arr: { x: number; z: number; h: number; c: THREE.Color }[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      let x = (Math.random() - 0.5) * 30;
      if (Math.abs(x) < 3.2) x += x < 0 ? -3.2 : 3.2; // keep the flight lane clear so no bar clips the camera
      const z = -4 - Math.random() * 104; // field ends at ~-108
      const h = 1.4 + Math.random() * 10;
      const t = Math.min(1, h / 11);
      c.setRGB(0.26 + 0.42 * t, 0.4 + 0.34 * t, 0.13 + 0.14 * t); // olive -> sage by height
      arr.push({ x, z, h, c: c.clone() });
    }
    return arr;
  }, []);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const d = new THREE.Object3D();
    bars.forEach((b, i) => {
      d.position.set(b.x, b.h / 2 - 6, b.z);
      d.scale.set(1, b.h, 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.setColorAt(i, b.c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [bars]);

  useFrame((s) => {
    const p = progress.current;
    s.camera.position.z = 16 - p * 146; // ends at ~-130, well past the last bar (~-108): a clean exit, no stuck bar
    s.camera.position.y = 0.6 + Math.sin(p * Math.PI) * 1.6;
    s.camera.position.x = Math.sin(p * Math.PI * 2) * 1.2;
    s.camera.lookAt(0, 0, s.camera.position.z - 20);
  });

  return <instancedMesh ref={mesh} args={[geo, mat, COUNT]} />;
}

export function CandlestickField() {
  const sectionRef = useRef<HTMLElement>(null);
  const l1 = useRef<HTMLDivElement>(null);
  const l2 = useRef<HTMLDivElement>(null);
  const progress = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const el = sectionRef.current;
      if (!el) return;
      const vh = window.innerHeight;
      const total = el.offsetHeight - vh;
      const scrolled = -el.getBoundingClientRect().top;
      const p = Math.max(0, Math.min(1, scrolled / Math.max(1, total)));
      progress.current = p;
      const tri = (center: number, width: number) =>
        Math.max(0, 1 - Math.abs(p - center) / width);
      if (l1.current) l1.current.style.opacity = String(tri(0.24, 0.2));
      if (l2.current) l2.current.style.opacity = String(tri(0.72, 0.22));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative"
      style={{ height: "280vh", background: "linear-gradient(180deg, var(--color-stage-1), var(--color-stage-2))" }}
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        <Canvas camera={{ position: [0, 0.6, 16], fov: 55 }} gl={{ alpha: true, antialias: true }} dpr={[1, 2]}>
          <fog attach="fog" args={["#0c0f07", 24, 96]} />
          <ambientLight intensity={0.6} color="#ece3d0" />
          <directionalLight intensity={2.4} color="#fff4dc" position={[6, 12, 4]} />
          <pointLight intensity={2.2} color="#9fc06a" position={[-8, 4, -20]} distance={80} />
          <Field progress={progress} />
        </Canvas>

        {/* overlay copy — fades as you fly */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div
            ref={l1}
            style={{ opacity: 0 }}
            className="font-display text-[clamp(2rem,5vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.02em] text-stage-cream"
          >
            A whole market, <span className="italic text-sage">moving.</span>
          </div>
          <div ref={l2} style={{ opacity: 0 }} className="absolute max-w-[24ch]">
            <p className="font-display text-[clamp(2rem,5vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.02em] text-stage-cream">
              One token holds <span className="italic text-sage">the index.</span>
            </p>
            <p className="mt-4 font-mono text-[12.5px] uppercase tracking-[0.16em] text-stage-cream/60">
              rebalanced by the agent · sealed by the contract
            </p>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-stage-cream/40">
          Arca Frontier · NVDA · MSFT · TSLA · GOOGL · SPCX
        </div>
      </div>
    </section>
  );
}
