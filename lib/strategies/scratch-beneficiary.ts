import type { Strategy } from "./types";
import { classifyTrack, isThoroughbred } from "../track-types";

// Fresh-scratch arbitrage. When a horse scratches close to post the TVG model
// re-normalizes winProbability across surviving runners on the next adapter
// poll (instant), but the live tote pool takes one or two rebroadcast cycles
// to redistribute the money. For a brief window after the scratch, the
// surviving runner with the biggest model bump is underpriced — its live EV
// is real because the pool hasn't yet absorbed the redistribution.
//
// Detection signal: a runner with scratched === true whose oddsHistory's most
// recent entry is fresh. When TVG flips a horse to scratched, the adapter's
// oddToDecimal returns 99 (no-odds sentinel), which differs from the prior
// real odds — applyHistory pushes that delta with the current timestamp. So
// a recent last-entry timestamp on a scratched runner is the scratch event
// itself, not stale history.
//
// Thesis: ride the redistribution lag. The runner with the highest live EV
// in the survivor field is what the model wants; the market will catch up
// within 30-90 seconds. Capturing odds before that adjustment is real edge.

const FRESH_SCRATCH_WINDOW_MS = 3 * 60_000;  // detect scratches in last 3 min
const MIN_SECONDS_TO_POST = 30;
const MAX_SECONDS_TO_POST = 300;             // beyond 5 min, pool has caught up
const MIN_WIN_POOL = 25_000;                 // require liquidity; thin pools are gameable
const MIN_FIELD_AFTER_SCRATCH = 4;
const MAX_LIVE_ODDS = 30;                    // skip huge longshots — EV noise dominates

export const scratchBeneficiaryStrategy: Strategy = {
  id: "scratch-beneficiary",
  appliesTo: ["thoroughbred"],
  name: "Scratch Beneficiary",
  thesis: "Ride the redistribution lag: when a horse scratches close to post, model EV updates instantly but the tote lags 30-90s. Capture the surviving runner with highest live EV before the pool catches up.",
  evaluate(race) {
    if (!isThoroughbred(classifyTrack(race.trackCode, race.track))) return null;
    if (race.phase !== "action" && race.phase !== "chaos") return null;
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST || secondsToPost > MAX_SECONDS_TO_POST) return null;
    if (race.winPoolTotal < MIN_WIN_POOL) return null;

    const now = Date.now();
    const recentScratches = race.runners.filter(r => {
      if (!r.scratched) return false;
      const last = r.oddsHistory[r.oddsHistory.length - 1];
      return last && (now - last.t) <= FRESH_SCRATCH_WINDOW_MS;
    });
    if (recentScratches.length === 0) return null;

    const live = race.runners.filter(
      r => !r.scratched && r.currentOdds > 1 && r.currentOdds < MAX_LIVE_ODDS,
    );
    if (live.length < MIN_FIELD_AFTER_SCRATCH) return null;

    const best = live.reduce((a, b) => b.evPercent > a.evPercent ? b : a, live[0]);
    if (best.evPercent <= 0) return null;

    const scratchedTxt = recentScratches
      .map(s => `#${s.program} ${s.name}`)
      .join(", ");
    return {
      selection: best.program,
      type: "WIN",
      evPercent: best.evPercent,
      reason: `Fresh scratch (${scratchedTxt}): model bump on ${best.name} not yet absorbed (live EV +${best.evPercent.toFixed(1)}%)`,
      confidence: 0.55,
    };
  },
};
