import type { Strategy } from "./types";

// Morning line is set by the track handicapper. When current odds drift
// significantly above the ML, the public is over-discounting a horse the
// expert thought reasonable. Pick the runner with the biggest favorable
// gap, provided it isn't a longshot (where ML is unreliable anyway).

const FALLBACK_TAKEOUT = 0.16;  // US WIN average; only used if race.takeout missing
const MIN_GAP = 0.5;  // current must be ≥150% of ML
const MAX_ML = 8;     // skip horses whose ML was already a longshot
const MIN_SECONDS_TO_POST = 90;

export const overlayVsMlStrategy: Strategy = {
  id: "overlay-vs-ml",
  appliesTo: ["thoroughbred"],
  name: "Overlay vs Morning Line",
  thesis: "Bet runners whose current odds are 50%+ above a credible morning line.",
  evaluate(race) {
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;
    const live = race.runners.filter(
      r => !r.scratched && r.currentOdds < 60 && r.morningLine && r.morningLine <= MAX_ML,
    );
    if (live.length < 4) return null;

    const candidates = live
      .map(r => ({ r, gap: (r.currentOdds - (r.morningLine ?? 0)) / (r.morningLine ?? 1) }))
      .filter(c => c.gap >= MIN_GAP)
      .sort((a, b) => b.gap - a.gap);
    if (!candidates.length) return null;

    const { r: best, gap } = candidates[0];
    // Treat ML as a NOISY estimate of fair value, not gospel truth. Blend ML
    // probability with market-implied probability — ML gets more weight when
    // the gap is moderate (signal), less weight on huge gaps (probable noise).
    const mlP = 1 / (best.morningLine ?? best.currentOdds);
    const marketP = 1 / best.currentOdds;
    // Calibration (audit 2026-06-29): 110 bets, -7.4% ROI, +43% CLV. The
    // strategy is "directionally right" (sharp money agrees we got value)
    // but the closing tote still loses, meaning ML systematically overrates
    // these picks. ML weights below were 0.40 → 0.20 by gap; cut to
    // 0.20 → 0.08 so market gets more pull. ML still has some signal at
    // moderate gaps, but on big-drift bombs we mostly trust market now.
    const mlWeight = Math.max(0.08, 0.20 - Math.max(0, gap - MIN_GAP) * 0.06);
    const fairP = mlWeight * mlP + (1 - mlWeight) * marketP;
    const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
    const ev = (fairP * (best.currentOdds - 1) * (1 - takeout) - (1 - fairP)) * 100;
    if (ev <= 0) return null;

    return {
      selection: best.program,
      type: "WIN",
      evPercent: ev,
      reason: `${best.name} ML ${best.morningLine?.toFixed(1)} → now ${best.currentOdds.toFixed(1)} (+${(gap * 100).toFixed(0)}% drift)`,
      confidence: Math.min(0.7, 0.35 + gap * 0.2),
    };
  },
};
