import type { Strategy } from "./types";
import { classifyTrack, isThoroughbred } from "../track-types";

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
// We cut the model's weight to MODEL_WEIGHT below (was effectively 0.65 in
// the adapter). At 0.30 the model's probability gets pulled most of the way
// back to market implied, which is roughly where realized hit rate has been
// landing. Doesn't filter longshots — they're still eligible — just requires
// the model to be much more confident before the post-calibration EV clears
// the threshold. Tune as the sample grows.
const MODEL_WEIGHT = 0.30;

export const tvgBaselineStrategy: Strategy = {
  id: "tvg-baseline",
  name: "TVG Model Baseline",
  thesis: "Trust TVG's winProbability when modelQuality === 'high', calibrated against realized P/L. Thoroughbred only.",
  evaluate(race) {
    if (race.modelQuality !== "high") return null;
    if (!isThoroughbred(classifyTrack(race.trackCode, race.track))) return null;
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;
    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
    if (live.length < 3) return null;

    // Recompute EV per runner using the calibrated model weight, then pick
    // the best. We can't just multiply the adapter's EV by a constant because
    // EV scales nonlinearly with trueP. Instead: back out the adapter's raw
    // model probability from its blend (modelWeight=0.65 for "high" quality,
    // 0.35 to market implied), re-blend at MODEL_WEIGHT, and recompute EV.
    const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
    const ADAPTER_MODEL_WEIGHT = 0.65;
    type Candidate = { runner: typeof live[number]; ev: number };
    let best: Candidate | null = null;
    for (const r of live) {
      if (r.truePWin == null) continue;
      const marketP = 1 / Math.max(1.2, r.currentOdds);
      // Recover the adapter's pre-blend model probability. If the blend wasn't
      // applied (e.g., r.truePWin == marketP for some fallback path), we get
      // marketP back — calibratedP then equals marketP and EV ≈ -takeout, which
      // correctly produces no fire.
      const rawModelP = Math.max(0.005, Math.min(0.95,
        (r.truePWin - (1 - ADAPTER_MODEL_WEIGHT) * marketP) / ADAPTER_MODEL_WEIGHT,
      ));
      const calibP = MODEL_WEIGHT * rawModelP + (1 - MODEL_WEIGHT) * marketP;
      const ev = (calibP * (r.currentOdds - 1) * (1 - takeout) - (1 - calibP)) * 100;
      if (ev > 0 && (best == null || ev > best.ev)) best = { runner: r, ev };
    }
    if (!best) return null;
    return {
      selection: best.runner.program,
      type: "WIN",
      evPercent: best.ev,
      reason: `TVG model EV +${best.ev.toFixed(1)}% on ${best.runner.name} (model: high, calibrated)`,
      confidence: 0.6,
    };
  },
};
