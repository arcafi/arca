"use client";

/* Client-side motion shims for the docs pages. The pages stay server components;
   these wrappers only animate the presentation. Both no-op under reduced motion. */

import { motion, useReducedMotion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

/** Fade-up once when the block scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, ease, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Page title: rises out of an overflow mask on load (docs H1 is always above the fold). */
export function HeadRise({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <span className="block overflow-hidden">
      <motion.span
        className="block"
        initial={{ y: "108%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.7, ease, delay }}
      >
        {children}
      </motion.span>
    </span>
  );
}
