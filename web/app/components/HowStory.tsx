"use client";

/* The how-it-works flow: a pinned, scroll-scrubbed stream of stock-chips.
   No diagram, no box — the story flows: chips stream IN and stack into five index
   columns (the bars are literally made of stocks), the agent's rebalance re-routes
   them (the green column migrates), they push outward and the rails hold, then the
   whole basket streams back OUT on redeem. Desktop only; mobile gets HowSteps. */

import { Canvas, useFrame } from "@react-three/fiber";
import { motion, useMotionValueEvent, useScroll, type MotionValue } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

export const STEPS: [string, string, string][] = [
  [
    "01",
    "Deposit the basket, mint the token",
    "Bring the underlying stocks; the vault mints your index token against them. Fully backed from the first block.",
  ],
  [
    "02",
    "The agent manages it",
    "A momentum strategy rotates the weights on schedule. Every trade lands on-chain with its rationale.",
  ],
  [
    "03",
    "Guardrails do the policing",
    "Whitelist, slippage cap, turnover cap, cooldown. Assets can move inside the vault — they cannot leave it.",
  ],
  [
    "04",
    "Redeem anytime, in-kind",
    "Burn the token, take every stock back in one transaction. No queue, no permission, no pause switch.",
  ],
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => t * t * (3 - 2 * t);

const N = 150;
const COLS = [-1.5, -0.75, 0, 0.75, 1.5];
const COLZ = [-0.5, 0.35, 0, 0.45, -0.4]; // depth spread — columns live in 3D, not a wall
const CNT_A = [24, 32, 28, 40, 26]; // chips per column, act 1 (sum 150)
const CNT_B = [36, 24, 40, 26, 24]; // after the agent's rebalance
const GREEN_A = 3;
const GREEN_B = 2;
const CHIP_H = 0.056;
const FLOOR = -1.45;
const INK = new THREE.Color("#17191B");
const GREEN = new THREE.Color("#1EA84D");

type Chip = { colA: number; iA: number; colB: number; iB: number; seed: number };

function buildChips(): Chip[] {
  const chips: Chip[] = [];
  const fillA: number[] = [];
  CNT_A.forEach((n, c) => {
    for (let k = 0; k < n; k++) fillA.push(c);
  });
  const idxA = [0, 0, 0, 0, 0];
  const idxB = [0, 0, 0, 0, 0];
  const remB = [...CNT_B];
  for (let i = 0; i < N; i++) {
    const colA = fillA[i];
    // keep the chip in its column when B still has room there, else re-route (those arc visibly)
    const colB = remB[colA] > 0 ? colA : remB.indexOf(Math.max(...remB));
    remB[colB]--;
    chips.push({ colA, iA: idxA[colA]++, colB, iB: idxB[colB]++, seed: (i * 2654435761) % 997 / 997 });
  }
  return chips;
}

function Chips({ progress }: { progress: MotionValue<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const chips = useMemo(buildChips, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const p = progress.get();
    const time = clock.elapsedTime;
    const t1 = ease(clamp01((p - 0.28) / 0.2)); // rebalance migration
    const t2 = clamp01((p - 0.53) / 0.2); // rails
    const railBump = Math.sin(Math.min(1, t2) * Math.PI);

    chips.forEach((c, i) => {
      // stream in (act 1) and out (act 4), staggered per chip
      const tIn = ease(clamp01((p / 0.26 - c.seed * 0.55) / 0.45));
      const tOut = ease(clamp01(((p - 0.78) / 0.2 - c.seed * 0.5) / 0.5));

      // settled position: stacked into columns (A -> B while the agent works)
      const xa = COLS[c.colA], ya = FLOOR + (c.iA + 0.5) * CHIP_H, za = COLZ[c.colA];
      const xb = COLS[c.colB], yb = FLOOR + (c.iB + 0.5) * CHIP_H, zb = COLZ[c.colB];
      const moved = c.colA !== c.colB;
      let x = THREE.MathUtils.lerp(xa, xb, t1);
      let y = THREE.MathUtils.lerp(ya, yb, t1) + (moved ? Math.sin(t1 * Math.PI) * 0.9 : 0);
      let z = THREE.MathUtils.lerp(za, zb, t1) + (moved ? Math.sin(t1 * Math.PI) * 0.4 : 0) + (c.seed - 0.5) * 0.06;

      // act 3: a few coins make a run for the wall — it flashes, they bounce back
      const escapee = c.seed > 0.8;
      if (escapee) {
        x += railBump * (2.0 - x);
        y += railBump * (0.3 + c.seed * 0.5);
        z += railBump * (0.15 - z) * 0.6;
      } else {
        x += railBump * 0.06;
      }

      // act 1: arrive along a flowing ribbon from the left
      if (tIn < 1) {
        const sx = -6.5 + c.seed * 1.6;
        const sy = 0.6 + Math.sin(c.seed * 31.4 + time * 0.7) * 0.55;
        const wave = Math.sin(tIn * Math.PI) * (0.65 + c.seed * 0.5);
        x = THREE.MathUtils.lerp(sx, x, tIn);
        y = THREE.MathUtils.lerp(sy, y, tIn) + wave * (1 - tIn);
        z = THREE.MathUtils.lerp(Math.sin(c.seed * 17) * 0.5, z, tIn);
      }
      // act 4: leave along the same ribbon, to the holder on the right
      if (tOut > 0) {
        const ex = 6.5 - c.seed * 1.4;
        const ey = 0.7 + Math.sin(c.seed * 23.1) * 0.6;
        x = THREE.MathUtils.lerp(x, ex, tOut);
        y = THREE.MathUtils.lerp(y, ey, tOut) + Math.sin(tOut * Math.PI) * 0.7;
      }

      const sIn = 0.35 + 0.65 * tIn;
      const s = sIn * (1 - tOut * 0.9);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, (1 - tIn) * c.seed * 4 + tOut * 2.2 * c.seed + (c.seed - 0.5) * 0.35, (1 - tIn) * 0.8);
      dummy.scale.setScalar(Math.max(0.0001, s));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      // color: the green column membership migrates with the agent
      const gA = c.colA === GREEN_A ? 1 : 0;
      const gB = c.colB === GREEN_B ? 1 : 0;
      const g = THREE.MathUtils.lerp(gA, gB, t1);
      color.copy(INK).lerp(GREEN, g);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
      <cylinderGeometry args={[0.155, 0.155, 0.048, 28]} />
      <meshStandardMaterial roughness={0.25} metalness={0.35} />
    </instancedMesh>
  );
}

/* the rails: two hairline uprights that flash when the mass leans on them */
function Rails({ progress }: { progress: MotionValue<number> }) {
  const matL = useRef<THREE.MeshBasicMaterial>(null);
  const matR = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const p = progress.get();
    const t2 = clamp01((p - 0.53) / 0.2);
    const vis = Math.sin(clamp01(t2) * Math.PI);
    const flash = Math.exp(-Math.pow(t2 - 0.55, 2) / 0.01);
    for (const r of [matL, matR]) {
      if (!r.current) continue;
      r.current.opacity = vis * 0.14 + flash * 0.5;
    }
  });
  return (
    <>
      <mesh position={[2.33, -0.25, 0]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[2.3, 2.6]} />
        <meshBasicMaterial ref={matR} color="#1EA84D" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[-2.33, -0.25, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[2.3, 2.6]} />
        <meshBasicMaterial ref={matL} color="#1EA84D" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </>
  );
}

/* token B — the index token: minted when the basket settles (act 1), BURNED at redeem (act 4),
   and only then do the stock coins (token A) stream back out. */
function IndexToken({ progress }: { progress: MotionValue<number> }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const p = progress.get();
    const t = clock.elapsedTime;
    const appear = ease(clamp01((p - 0.18) / 0.08));
    const burn = clamp01((p - 0.74) / 0.1);
    const s = appear * (1 - ease(burn));
    if (g.current) {
      g.current.visible = appear > 0.01;
      g.current.scale.setScalar(Math.max(0.001, s));
      g.current.position.y = 1.4 + Math.sin(t * 1.3) * 0.08;
      g.current.rotation.y = t * 0.9 + burn * 7;
    }
    if (mat.current) {
      mat.current.color.lerpColors(GREEN, new THREE.Color("#E4572E"), burn);
      mat.current.emissive.copy(mat.current.color);
      mat.current.emissiveIntensity = 0.5 + burn * 3.5;
    }
    if (ring.current) {
      ring.current.visible = burn > 0.01;
      ring.current.scale.setScalar(1 + burn * 3.4);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.min(1, burn) * Math.PI) * 0.55;
    }
  });
  return (
    <group ref={g} position={[0, 1.4, 0]} visible={false}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.44, 0.44, 0.09, 40]} />
        <meshStandardMaterial ref={mat} color="#1EA84D" emissive="#1EA84D" emissiveIntensity={0.5} roughness={0.25} metalness={0.3} />
      </mesh>
      <mesh ref={ring} visible={false}>
        <torusGeometry args={[0.52, 0.022, 10, 48]} />
        <meshBasicMaterial color="#E4572E" transparent opacity={0} depthWrite={false} />
      </mesh>
      <pointLight intensity={1.4} distance={3} color="#1EA84D" />
    </group>
  );
}

/* rotates with scroll — lives INSIDE the Canvas so R3F hooks are legal */
function FlowRoot({ progress, children }: { progress: MotionValue<number>; children: React.ReactNode }) {
  const root = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!root.current) return;
    const t = clock.elapsedTime;
    root.current.rotation.y = -0.45 + progress.get() * 0.75 + Math.sin(t * 0.4) * 0.03;
    root.current.position.y = Math.sin(t * 0.8) * 0.05;
  });
  return <group ref={root}>{children}</group>;
}

function FlowScene({ progress }: { progress: MotionValue<number> }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [3.6, 2.6, 8.8], fov: 27 }}
      onCreated={({ camera }) => camera.lookAt(0, -0.3, 0)}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={1.05} />
      <hemisphereLight intensity={0.55} color="#ffffff" groundColor="#d8ded8" />
      <directionalLight position={[4, 6, 3]} intensity={1.5} />
      <directionalLight position={[-4, 2, -3]} intensity={0.5} color="#dff2e4" />
      <FlowRoot progress={progress}>
        <Chips progress={progress} />
        <Rails progress={progress} />
        <IndexToken progress={progress} />
        {/* the vault: thin glass + drawn edges — container reads instantly, chips never hidden */}
        <mesh position={[0, -0.25, 0]}>
          <boxGeometry args={[4.8, 2.7, 2.4]} />
          <meshPhysicalMaterial color="#ffffff" transparent opacity={0.06} roughness={0.12} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <lineSegments position={[0, -0.25, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(4.8, 2.7, 2.4)]} />
          <lineBasicMaterial color="#17191B" transparent opacity={0.4} />
        </lineSegments>
        {/* the base the basket stands on — the only fixed thing in the flow */}
        <mesh position={[0, FLOOR - 0.12, 0]}>
          <boxGeometry args={[4.7, 0.12, 2.2]} />
          <meshStandardMaterial color="#17191B" roughness={0.45} metalness={0.25} />
        </mesh>
      </FlowRoot>
    </Canvas>
  );
}

export function HowStory() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [phase, setPhase] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setPhase(Math.min(3, Math.floor(v * 4.05))));

  return (
    <section id="how" ref={ref} className="relative hidden lg:block" style={{ height: "460vh" }}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1180px] grid-cols-[0.9fr_1.1fr] items-center gap-8 px-6">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted">How it works</p>
            <h2 className="mt-3 max-w-[16ch] font-display text-[clamp(1.8rem,3.2vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.02em]">
              Watch the basket flow.
            </h2>
            <div className="mt-8 space-y-1.5">
              {STEPS.map(([n, t, d], i) => (
                <motion.div
                  key={n}
                  animate={{ opacity: phase === i ? 1 : 0.34 }}
                  transition={{ duration: 0.35 }}
                  className={`rounded-2xl border px-5 py-4 transition-colors ${
                    phase === i ? "border-green/50 bg-white" : "border-transparent"
                  }`}
                >
                  <div className="flex items-baseline gap-3">
                    <span className={`font-mono text-[11px] ${phase === i ? "text-green-deep" : "text-muted"}`}>
                      {n}
                    </span>
                    <h3 className="font-display text-[16.5px] font-semibold tracking-tight">{t}</h3>
                  </div>
                  <p className="mt-1 pl-[30px] text-[13.5px] leading-relaxed text-muted">{d}</p>
                </motion.div>
              ))}
            </div>
          </div>
          <div className="h-[600px]" aria-hidden>
            <FlowScene progress={scrollYProgress} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Mobile / reduced fallback: the same four steps, plain and quick. */
export function HowSteps() {
  return (
    <section id="how-m" className="mx-auto max-w-[1120px] px-6 py-20 lg:hidden">
      <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted">How it works</p>
      <h2 className="mt-3 font-display text-[clamp(1.7rem,6vw,2.2rem)] font-semibold tracking-[-0.02em]">
        One loop: mint, manage, redeem.
      </h2>
      <div className="relative mt-8 pl-8">
        <div className="absolute left-[9px] top-3 bottom-3 w-px bg-hair" />
        {STEPS.map(([n, t, d]) => (
          <div key={n} className="relative pb-7 last:pb-0">
            <span className="absolute -left-8 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-green/50 bg-canvas font-mono text-[9.5px] font-medium text-green-deep">
              {n}
            </span>
            <h3 className="font-display text-[16.5px] font-semibold tracking-tight">{t}</h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
