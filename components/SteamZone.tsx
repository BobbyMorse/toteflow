"use client";
// Live "is this steam pick still worth betting RIGHT NOW" panel for the race
// monitor. The strategy fires at post inside the drag window (paper-only, no
// manual lead time) — so for a HUMAN placing by hand, the workflow is: get the
// surfaced alert early, open this page, watch the crush live, and place at the
// last second ONLY while the pick is still in the profitable zone.
//
// The zone is NOT "did it crush 15-35%" — the 2026-09 analysis showed the crush
// routinely eats the model's own edge (median fire EV ~-12%); the win signal
// lives in the fires where value SURVIVED the crush (EV still >= 0 at the live
// price). So this recomputes the model's calibrated EV at the current odds and
// tells you, live, whether value has survived — the same fire-EV floor the
// tvg-steam-evfloor / -continuation shadows gate on, surfaced for manual play.
import { useMemo } from "react";
import type { Race } from "@/lib/types";
import { calibrateTVGBaselineTrueP, evPercentFromTrueP } from "@/lib/strategy-calibration";
import clsx from "clsx";

const CRUSH_BAND: readonly [number, number] = [15, 35];
const FALLBACK_TAKEOUT = 0.16;

export default function SteamZone({ race }: { race: Race }) {
  const pick = useMemo(() => {
    // tvg-steam only acts on high-quality model races.
    if (race.modelQuality !== "high") return null;
    const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
    let best: { prog: string; name: string; frac: string; odds: number; ev: number; p: number; open: number } | null = null;
    for (const r of race.runners) {
      if (r.scratched || r.truePWin == null) continue;
      if (r.currentOdds < 1.2 || r.currentOdds >= 60) continue;
      const marketP = 1 / Math.max(1.2, r.currentOdds);
      const calibP = calibrateTVGBaselineTrueP(r.truePWin, marketP);
      if (calibP <= marketP) continue; // model must prefer it vs the market
      const ev = evPercentFromTrueP(calibP, r.currentOdds, takeout);
      if (!best || ev > best.ev) {
        const open = r.oddsHistory?.[0]?.odds ?? r.morningLine ?? r.currentOdds;
        best = { prog: r.program, name: r.name, frac: r.fractionalOdds, odds: r.currentOdds, ev, p: calibP, open };
      }
    }
    if (!best) return null;
    const crush = best.open > 0 ? ((best.open - best.odds) / best.open) * 100 : 0;
    return { ...best, crush };
  }, [race]);

  if (!pick) return null;

  const off = race.postTime - Date.now() <= 0;
  const inZone = pick.ev >= 0;
  const marginal = pick.ev >= -5 && pick.ev < 0;
  const tone = inZone ? "overlay" : marginal ? "warn" : "chaos";
  // Literal class strings only — Tailwind JIT can't see `text-accent-${tone}`.
  const toneCls = {
    overlay: "border-accent-overlay/50 bg-accent-overlay/10 text-accent-overlay",
    warn: "border-accent-warn/50 bg-accent-warn/10 text-accent-warn",
    chaos: "border-accent-chaos/50 bg-accent-chaos/10 text-accent-chaos",
  }[tone];
  const toneText = {
    overlay: "text-accent-overlay",
    warn: "text-accent-warn",
    chaos: "text-accent-chaos",
  }[tone];

  const zoneLabel = inZone ? "IN THE ZONE" : marginal ? "MARGINAL" : "VALUE GONE";
  const verdict = off
    ? "Pool closing / closed — too late to place."
    : inZone
      ? "Value survived the move — this is a placeable price."
      : marginal
        ? "Value nearly eaten — thin edge. Your call."
        : "The crush pushed past fair value — skip it.";

  // Crush confirmation status (the ENTRY condition, separate from value).
  const bandState =
    pick.crush > CRUSH_BAND[1] ? { label: `overshot ${pick.crush.toFixed(0)}%`, cls: "text-accent-chaos" }
    : pick.crush >= CRUSH_BAND[0] ? { label: `confirmed ${pick.crush.toFixed(0)}%`, cls: "text-accent-overlay" }
    : pick.crush > 0 ? { label: `${pick.crush.toFixed(0)}% — not yet 15%`, cls: "text-ink-2" }
    : { label: "drifting out", cls: "text-ink-2" };

  return (
    <div className={clsx("panel p-4 border", toneCls, "border-l-2")}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-ink-0">🔥 Steam Zone</h3>
        <span className={clsx("chip border font-mono text-[11px]", toneCls)}>{zoneLabel}</span>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-ink-0 font-semibold truncate">#{pick.prog} {pick.name}</div>
          <div className="text-xs text-ink-2 font-mono">@ {pick.frac} ({pick.odds.toFixed(2)}) · model P {(pick.p * 100).toFixed(1)}%</div>
        </div>
        <div className="text-right shrink-0">
          <div className={clsx("text-2xl font-display font-semibold tabular-nums", toneText)}>
            {pick.ev >= 0 ? "+" : ""}{pick.ev.toFixed(1)}%
          </div>
          <div className="stat-label">live EV @ this price</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-ink-2">
        <span>Move since open: <span className={bandState.cls}>{bandState.label}</span></span>
        <span>Open {pick.open.toFixed(1)} → now {pick.odds.toFixed(1)}</span>
      </div>

      <div className={clsx("mt-3 text-sm font-medium", toneText)}>{verdict}</div>
      <div className="mt-1 text-[11px] text-ink-2 leading-snug">
        Place by hand at the last second <span className="text-ink-1">only while this stays green</span> (value ≥ 0).
        The crush often eats the edge before post — green means the model still likes it at the price you can actually get.
      </div>
    </div>
  );
}
