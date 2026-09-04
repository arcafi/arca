"use client";

/* "Index terrain" — the hero signature, generated purely in code.
   A plane displaced by simplex-noise fbm (vertex) with contour scanlines drawn per-pixel
   (fragment, fwidth-antialiased => razor sharp at any DPR). Ink hairlines on canvas,
   one emerald contour band; mouse raises the terrain locally, scroll feeds amplitude. */

import { Canvas, useFrame } from "@react-three/fiber";
import { useScroll } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform vec2 uMouse; // plane-space, -1..1
  varying vec2 vUv;
  varying float vH;

  // Ashima 2D simplex noise
  vec3 permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p){
    float f = 0.0;
    f += 0.5000 * snoise(p);
    f += 0.2500 * snoise(p * 2.03 + 17.1);
    f += 0.1250 * snoise(p * 4.01 - 9.7);
    return f;
  }

  void main(){
    vUv = uv;
    vec3 pos = position;
    vec2 q = pos.xy * 0.32;
    float h = fbm(q + vec2(uTime * 0.045, uTime * 0.03));
    // mouse raises the terrain around it
    float md = distance(pos.xy / vec2(5.5, 3.2), uMouse);
    h += smoothstep(0.55, 0.0, md) * 0.55;
    // calm strip near the far edge so it fades gracefully
    h *= smoothstep(1.02, 0.55, uv.y);
    pos.z = h * uAmp;
    vH = h;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uInk;
  uniform vec3 uGreen;
  varying vec2 vUv;
  varying float vH;

  float lineAA(float f, float w){
    float d = min(f, 1.0 - f);
    float aa = fwidth(f) * w;
    return 1.0 - smoothstep(0.0, aa, d);
  }

  void main(){
    // horizontal scanlines that ride the displaced surface
    float rows = 46.0;
    float ln = lineAA(fract(vUv.y * rows), 1.15);
    // faint vertical grid
    float cols = 72.0;
    float lc = lineAA(fract(vUv.x * cols), 0.9) * 0.22;

    // emerald contour band where the terrain crests
    float band = smoothstep(0.34, 0.44, vH) * (1.0 - smoothstep(0.52, 0.66, vH));
    vec3 col = mix(uInk, uGreen, clamp(band * 1.6, 0.0, 1.0));

    float a = max(ln, lc);
    // depth fade: quieter far away, strongest mid-field
    a *= mix(0.2, 0.6, smoothstep(1.0, 0.35, vUv.y));
    a *= smoothstep(0.0, 0.06, vUv.y);
    // green lines glow a touch stronger
    a += band * ln * 0.5;

    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

function TerrainMesh() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const { scrollYProgress } = useScroll();
  // global mouse (the canvas is pointer-events-none so text/CTAs stay clickable)
  const mouse = useRef(new THREE.Vector2(10, 10));
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 1.15 },
      uMouse: { value: new THREE.Vector2(10, 10) },
      uInk: { value: new THREE.Color("#17191B") },
      uGreen: { value: new THREE.Color("#1EA84D") },
    }),
    [],
  );

  useFrame(({ clock }) => {
    const m = mat.current;
    if (!m) return;
    m.uniforms.uTime.value = clock.elapsedTime;
    // hero scroll (first ~12% of page) breathes the amplitude up
    const s = Math.min(1, scrollYProgress.get() * 8);
    m.uniforms.uAmp.value = 1.05 + s * 0.3;
    const t = mouse.current;
    m.uniforms.uMouse.value.lerp(new THREE.Vector2(t.x, t.y * 0.6 + 0.15), 0.06);
  });

  return (
    <mesh rotation={[-1.02, 0, 0]} position={[0, -1.35, 0]}>
      <planeGeometry args={[11, 6.4, 220, 130]} />
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function Terrain() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.9, 4.6], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
    >
      <TerrainMesh />
    </Canvas>
  );
}
