import type { Strategy } from "./types";
import { calibrateTVGBaselineTrueP, evPercentFromTrueP } from "../strategy-calibration";

const MIN_SECONDS_TO_POST = 90;
const FALLBACK_TAKEOUT = 0.16;

// Empirical calibration. The TVG adapter's trueP blend gives the model 65%
// weight on "high" quality races and 35% to market, then computes EV at
// current odds. Realized track record on this strategy (159 bets, audit
// 2026-06-29): -21% ROI on +22.7% avg captured EV (capped — true raw avg
// likely much higher). Strongly positive CLV (+34.8%) confirms the model is
// "sharp" in the sense that other money agrees, but pari-mutuel pays at
// the closing tote and the closing tote still has favorite-longshot bias —
// so the sharp money is co-overrating the same bombs we are.
//
// The recalibration itself lives in lib/strategy-calibration.ts so the
// tickets page can recompute the same trueP for its live "model fair" and
// "live EV" displays. Change the weight there.

export const tvgBaselineStrategy: Strategy = {
  id: "tvg-baseline",
  appliesTo: ["thoroughbred"],
  name: "TVG Model Baseline",
  thesis: "Trust TVG's winProbability when modelQuality === 'high', calibrated against realized P/L.",
  evaluate(race) {
    if (race.modelQuality !== "high") return null;
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;
    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
    if (live.length < 3) return null;

    // Recompute EV per runner using the calibrated model weight, then pick
    // the best. Calibration formula lives in lib/strategy-calibration.ts.
    const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
    type Candidate = { runner: typeof live[number]; ev: number; trueP: number };
    let best: Candidate | null = null;
    for (const r of live) {
      if (r.truePWin == null) continue;
      const marketP = 1 / Math.max(1.2, r.currentOdds);
      const calibP = calibrateTVGBaselineTrueP(r.truePWin, marketP);
      const ev = evPercentFromTrueP(calibP, r.currentOdds, takeout);
      if (ev > 0 && (best == null || ev > best.ev)) best = { runner: r, ev, trueP: calibP };
    }
    if (!best) return null;
    return {
      selection: best.runner.program,
      type: "WIN",
      evPercent: best.ev,
      truePWin: best.trueP,
      reason: `TVG model P=${(best.trueP * 100).toFixed(1)}% → EV +${best.ev.toFixed(1)}% on ${best.runner.name} (model: high, calibrated)`,
      confidence: 0.6,
    };
  },
};
