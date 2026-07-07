// Standard tote-board fractions
const FRACTIONS: { n: number; d: number; v: number }[] = [
  { n: 1, d: 9 }, { n: 1, d: 5 }, { n: 2, d: 5 }, { n: 1, d: 2 }, { n: 3, d: 5 }, { n: 4, d: 5 },
  { n: 1, d: 1 }, { n: 6, d: 5 }, { n: 7, d: 5 }, { n: 3, d: 2 }, { n: 8, d: 5 }, { n: 9, d: 5 },
  { n: 2, d: 1 }, { n: 5, d: 2 }, { n: 3, d: 1 }, { n: 7, d: 2 }, { n: 4, d: 1 }, { n: 9, d: 2 },
  { n: 5, d: 1 }, { n: 6, d: 1 }, { n: 7, d: 1 }, { n: 8, d: 1 }, { n: 9, d: 1 }, { n: 10, d: 1 },
  { n: 12, d: 1 }, { n: 15, d: 1 }, { n: 20, d: 1 }, { n: 30, d: 1 }, { n: 50, d: 1 }, { n: 99, d: 1 },
].map(f => ({ ...f, v: f.n / f.d }));

export function fractionalOdds(decimal: number): string {
  if (!isFinite(decimal) || decimal <= 1.01) return "1/9";
  const dec = decimal - 1;
  let best = FRACTIONS[0], bestErr = Infinity;
  for (const f of FRACTIONS) {
    const err = Math.abs(dec - f.v);
    if (err < bestErr) { bestErr = err; best = f; }
  }
  if (best.d === 1 && best.n === 1) return "1/1";
  return `${best.n}/${best.d}`;
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtCountdown(ms: number): { mm: string; ss: string; total: number } {
  const total = Math.max(0, ms);
  const s = Math.floor(total / 1000);
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return { mm, ss, total };
}

export function phaseOf(ms: number): "scheduled" | "discovery" | "action" | "chaos" | "off" {
  if (ms > 15 * 60_000) return "scheduled";
  if (ms > 5 * 60_000) return "discovery";
  if (ms > 60_000) return "action";
  if (ms > 0) return "chaos";
  return "off";
}

export function evColor(ev: number): string {
  if (ev > 15) return "text-accent-overlay";
  if (ev > 5) return "text-emerald-300";
  if (ev > -5) return "text-ink-1";
  if (ev > -15) return "text-amber-300";
  return "text-accent-steam";
}

export function steamColor(score: number): string {
  if (score >= 80) return "bg-accent-steam";
  if (score >= 60) return "bg-accent-warn";
  if (score >= 40) return "bg-accent-info";
  return "bg-bg-3";
}
