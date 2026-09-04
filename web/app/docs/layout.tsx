import type { Metadata } from "next";
import { Logo } from "../components/Logo";
import { DocsNav } from "./nav";

export const metadata: Metadata = {
  title: "Arca Docs — managed onchain stock indexes",
  description:
    "How Arca works: fully-backed stock index vaults on Robinhood Chain, run by an autonomous agent that can never reach custody.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-ink">
      {/* top bar */}
      <div className="sticky top-0 z-40 border-b border-hair bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3.5 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight">
            <Logo className="h-5 w-auto" />
            Arca
            <span className="ml-1 hidden rounded-md bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted sm:inline-block">
              docs
            </span>
          </a>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="group inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 font-display text-[13.5px] font-medium text-ink shadow-[0_1px_2px_rgba(23,25,27,0.04)] transition-colors hover:border-ink/30"
            >
              <span aria-hidden className="text-green-deep transition-transform group-hover:-translate-x-0.5">
                ←
              </span>
              Back to site
            </a>
            <a
              href="https://github.com/Arca/Arca"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-display text-[13.5px] font-medium text-canvas transition-transform hover:-translate-y-px"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1180px] gap-10 px-6 py-10 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <DocsNav />
        </aside>
        <main className="min-w-0 pb-24">{children}</main>
      </div>
    </div>
  );
}
