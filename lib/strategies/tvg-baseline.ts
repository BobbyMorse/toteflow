import type { Strategy } from "./types";
import type { Discipline } from "../track-types";
import {
  calibrateTVGBaselineTrueP,
  calibrateTVGBaselineHarnessTrueP,
  calibrateTVGBaselineQHTrueP,
  evPercentFromTrueP,
} from "../strategy-calibration";

const MIN_SECONDS_TO_POST = 15;
const FALLBACK_TAKEOUT = 0.16;

// Empirical calibration. The TVG adapter's trueP blend gives the model 65%
// weight on "high" quality races and 35% to market, then computes EV at
// current odds. Thoroughbred: 159 bets, -21% ROI on the raw 0.65 weight,
// re-blended down to 0.30 → +12.6% ROI (audit 2026-06-29). Harness at the
// same 0.30 weight is -64.6% over 68 bets — TVG's model is thoroughbred-fit
// and overrates harness picks, so harness runs at 0.15. QH matches harness
// until we have data to fit its own. Weights and per-variant calibrators
// live in lib/strategy-calibration.ts so the tickets page can recompute
// the same trueP for live displays.

type TrueP = (adapterTrueP: number, marketP: number) => number;

function build(id: string, name: string, appliesTo: Discipline[], calibrate: TrueP): Strategy {
  return {
    id,
    appliesTo,
    name,
    thesis: "Trust TVG's winProbability when modelQuality === 'high', calibrated against realized P/L.",
    evaluate(race) {
      if (race.modelQuality !== "high") return null;
      const secondsToPost = (race.postTime - Date.now()) / 1000;
      if (secondsToPost < MIN_SECONDS_TO_POST) return null;
      const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
      if (live.length < 3) return null;

      const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
      type Candidate = { runner: typeof live[number]; ev: number; trueP: number };
      let best: Candidate | null = null;
      for (const r of live) {
        if (r.truePWin == null) continue;
        const marketP = 1 / Math.max(1.2, r.currentOdds);
        const calibP = calibrate(r.truePWin, marketP);
        const ev = evPercentFromTrueP(calibP, r.currentOdds, takeout);
        if (ev > 0 && (best == null || ev > best.ev)) best = { runner: r, ev, trueP: calibP };
      }
      if (!best) return null;

      // CRITICAL VALIDATION: ensure returned P and EV are mathematically consistent.
      // If they diverge, recalculate EV from P to prevent storing impossible pairs
      // like "19.7% → +17.6% @ 3/1 odds" (which is mathematically impossible).
      const recomputedEV = evPercentFromTrueP(best.trueP, best.runner.currentOdds, takeout);
      const evDivergence = Math.abs(recomputedEV - best.ev);
      let finalEV = best.ev;
      if (evDivergence > 2.0) {
        // EV diverges by more than 2pp — recalculate it from the P to ensure consistency.
        console.warn(
          `[${this.id}] Corrected EV on ${best.runner.name}: ` +
          `trueP=${(best.trueP * 100).toFixed(1)}% @ ${best.runner.currentOdds.toFixed(2)}x ` +
          `was ${best.ev.toFixed(1)}%, recalculated to ${recomputedEV.toFixed(1)}%`
        );
        finalEV = recomputedEV;
      }

      return {
        selection: best.runner.program,
        type: "WIN",
        evPercent: finalEV,
        truePWin: best.trueP,
        reason: `TVG model P=${(best.trueP * 100).toFixed(1)}% → EV +${finalEV.toFixed(1)}% on ${best.runner.name} (model: high, calibrated)`,
        confidence: 0.6,
      };
    },
  };
}

export const tvgBaselineStrategy: Strategy = build(
  "tvg-baseline", "TVG Model Baseline", ["thoroughbred"], calibrateTVGBaselineTrueP,
);

export const tvgBaselineHarnessStrategy: Strategy = build(
  "tvg-baseline-harness", "TVG Model Baseline (Harness)", ["harness"], calibrateTVGBaselineHarnessTrueP,
);

export const tvgBaselineQHStrategy: Strategy = build(
  "tvg-baseline-qh", "TVG Model Baseline (QH)", ["quarter-horse"], calibrateTVGBaselineQHTrueP,
);
