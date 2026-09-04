"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/** Site-wide inertia scroll (Lenis) + robust anchor jumps.
 *  Lenis smooths the wheel on desktop and no-ops under prefers-reduced-motion;
 *  anchor clicks are always intercepted so #jumps land even when the target is a
 *  desktop-only section hidden on mobile (falls back to its `-m` twin). */
export function SmoothScroll() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let lenis: Lenis | undefined;
    let raf = 0;
    if (!reduce) {
      lenis = new Lenis({ lerp: 0.11 });
      // expose for tooling/integrations (GSAP ScrollTrigger, e2e checks)
      (window as unknown as { lenis?: Lenis }).lenis = lenis;
      const loop = (t: number) => {
        lenis!.raf(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    // route anchor clicks so #jumps glide and clear the floating nav
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const id = a.getAttribute("href")!;
      if (id.length < 2) return;
      let el = document.querySelector(id) as HTMLElement | null;
      // desktop-only sections are display:none on mobile — fall back to their mobile
      // twin (same id + "-m") so the jump lands on visible content instead of nothing
      if (el && el.getClientRects().length === 0) {
        const twin = document.querySelector(`${id}-m`) as HTMLElement | null;
        if (twin) el = twin;
      }
      if (!el || el.getClientRects().length === 0) return;
      e.preventDefault();
      if (lenis) {
        lenis.scrollTo(el, { offset: -96, duration: 1.1 });
      } else {
        const y = el.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    };
    document.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", onClick);
      lenis?.destroy();
    };
  }, []);
  return null;
}
