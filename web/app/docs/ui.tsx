/* Small server-side building blocks for the docs pages — keeps every page consistent.
   Motion lives in reveal.tsx (client); these stay server components. */

import { HeadRise, Reveal } from "./reveal";

export function H1({ children, kicker }: { children: React.ReactNode; kicker?: string }) {
  return (
    <header className="mb-8">
      {kicker && (
        <Reveal>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-green-deep">{kicker}</p>
        </Reveal>
      )}
      <h1 className="font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.02em]">
        <HeadRise delay={0.08}>{children}</HeadRise>
      </h1>
    </header>
  );
}

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <h2
        id={id}
        className="group mt-12 mb-4 scroll-mt-28 font-display text-[22px] font-semibold tracking-tight"
      >
        <a href={`#${id}`} className="hover:text-green-deep">
          {children}
        </a>
      </h2>
    </Reveal>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <Reveal>
      <p className="my-4 max-w-[68ch] text-[15px] leading-relaxed text-[#3b3f42]">{children}</p>
    </Reveal>
  );
}

export function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <Reveal>
      <ul className="my-4 max-w-[68ch] space-y-2 text-[15px] leading-relaxed text-[#3b3f42]">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-green/70" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

export function Callout({ title, children, tone = "green" }: { title: string; children: React.ReactNode; tone?: "green" | "amber" }) {
  const border = tone === "green" ? "border-green/40" : "border-[#c98a2b]/40";
  const label = tone === "green" ? "text-green-deep" : "text-[#9a6a1f]";
  return (
    <Reveal>
      <div className={`my-6 max-w-[68ch] rounded-2xl border ${border} bg-white px-5 py-4`}>
        <p className={`mb-1 font-mono text-[11px] uppercase tracking-[0.12em] ${label}`}>{title}</p>
        <div className="text-[14px] leading-relaxed text-[#3b3f42]">{children}</div>
      </div>
    </Reveal>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <Reveal>
      <div className="my-6 overflow-x-auto rounded-2xl border border-hair bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-hair">
              {head.map((h) => (
                <th key={h} className="px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-hair/60 last:border-0">
                {r.map((c, j) => (
                  <td key={j} className="px-4 py-3 align-top text-[#3b3f42]">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Reveal>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <Reveal>
      <pre className="my-5 max-w-full overflow-x-auto rounded-2xl bg-dark px-5 py-4 font-mono text-[12.5px] leading-relaxed text-[#d8dcd9]">
        {children}
      </pre>
    </Reveal>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[12.5px]">{children}</code>;
}

export function NextPage({ href, label }: { href: string; label: string }) {
  return (
    <Reveal>
      <div className="mt-14 border-t border-hair pt-6">
        <a
          href={href}
          className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-5 py-2.5 font-display text-[14px] font-medium transition-colors hover:border-ink/40"
        >
          Next: {label} <span className="text-green-deep">→</span>
        </a>
      </div>
    </Reveal>
  );
}
