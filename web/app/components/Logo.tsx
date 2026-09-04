/**
 * Arca mark — the supplied brand logo (the open strongbox), background removed and
 * recoloured to the brand olive / cream. Raster on purpose: it's the real asset, not a redraw.
 *   variant="olive" (default) — for the cream UI · variant="cream" — for dark sections
 */
export function Logo({
  className,
  variant = "olive",
}: {
  className?: string;
  variant?: "olive" | "cream";
}) {
  const src = variant === "cream" ? "/arca-mark-cream.png" : "/arca-mark.png";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Arca" className={className} />;
}
