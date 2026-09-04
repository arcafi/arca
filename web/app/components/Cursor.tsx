"use client";

/* Arca cursor — a single olive blob that trails the pointer and blends into the page
   with `multiply` (organic, paper-like). Over links it opens into a soft halo.
   Deliberately unlike the old dot+ring; desktop fine-pointer only, native cursor kept. */

import { useEffect, useRef } from "react";

export function Cursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current!;
    el.style.opacity = "1";
    let x = -100, y = -100, cx = -100, cy = -100, hov = false, raf = 0;

    const move = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      hov = !!(e.target as HTMLElement).closest?.("a,button,[role=button],input,label");
    };
    const loop = () => {
      cx += (x - cx) * 0.2;
      cy += (y - cy) * 0.2;
      const s = hov ? 48 : 15;
      el.style.transform = `translate(${cx - s / 2}px, ${cy - s / 2}px)`;
      el.style.width = el.style.height = `${s}px`;
      el.style.background = hov
        ? "color-mix(in srgb, #465626 20%, transparent)"
        : "#465626";
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("mousemove", move);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("mousemove", move);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] hidden lg:block">
      <div
        ref={ref}
        className="absolute rounded-full opacity-0 transition-[width,height,background] duration-300"
        style={{ width: 15, height: 15, mixBlendMode: "multiply" }}
      />
    </div>
  );
}
