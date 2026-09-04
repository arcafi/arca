"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

const ease = [0.22, 1, 0.36, 1] as const;

const items: [string, string][] = [
  ["Overview", "/docs"],
  ["How it works", "/docs/how-it-works"],
  ["Architecture", "/docs/architecture"],
  ["Security & invariants", "/docs/security"],
  ["Contracts & addresses", "/docs/contracts"],
];

export function DocsNav() {
  const path = usePathname();
  const reduce = useReducedMotion();
  return (
    <nav className="flex flex-col gap-1">
      <p className="mb-2 px-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
        Documentation
      </p>
      {items.map(([label, href], i) => {
        const active = path === href;
        return (
          <motion.a
            key={href}
            href={href}
            initial={reduce ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease, delay: 0.05 + i * 0.06 }}
            className={`rounded-xl px-3 py-2 text-[14px] transition-colors ${
              active
                ? "bg-ink/[0.05] font-medium text-ink"
                : "text-muted hover:bg-ink/[0.03] hover:text-ink"
            }`}
          >
            {label}
          </motion.a>
        );
      })}
    </nav>
  );
}
