"use client";

import { useEffect } from "react";

/**
 * One global pointer listener that tells the cursor-aware surfaces (`.spotlight`, `.hero-surface`) where the
 * pointer is, as CSS variables, so their glow can follow it. It does nothing on touch screens or when the
 * person prefers reduced motion.
 */
export function CursorEffects() {
  useEffect(() => {
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!canHover || reduced) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest<HTMLElement>(".spotlight, .hero-surface");
      if (!el) return;
      const { clientX, clientY } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${clientX - r.left}px`);
        el.style.setProperty("--my", `${clientY - r.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
