import type { Strategy } from "./types";
import { RaceResults } from "../race-results";

// Same-day track-bias detector. Watches the day's earlier races at each track
// (filtered to the same surface) and bets horses whose post-position tier
// matches the observed winning pattern.
//
// Honest limits:
//   - Program number is used as a proxy for post position. In flat
//     thoroughbred racing they're identical except for coupled entries (rare).
//   - Sample size is small — a single day's card has 6-12 races per track.
//     With MIN_SAMPLE = 5 we need to wait several races before the strategy
//     activates, and even at 5-8 results the signal is statistically thin.
//   - Bias triggers require a clear concentration (≥60% of winners in one
//     tier) to fight the small-sample noise. This means we miss subtle biases
//     but don't fire on coin-flip variance.
//
// Thesis: real track biases exist (rail position, surface moisture, kickback,
// turf rail position changes between races) and persist across a day's card.
// The public adjusts slowly because they don't process the bias systematically
// from race to race. Riding a confirmed bias is real, durable edge.

const MIN_SAMPLE_RACES = 5;
const MIN_TIER_SHARE = 0.60;        // ≥60% of winners in one tier to declare bias
const MIN_SECONDS_TO_POST = 60;
const MAX_SECONDS_TO_POST = 600;    // up to 10 min before post
const MIN_FIELD = 5;
const MAX_LIVE_ODDS = 30;
const MIN_LIVE_EV = -2;             // small negative EV OK if bias is strong

type Tier = "inside" | "outside";

function tierOf(program: string, fieldSize: number): Tier | null {
  // Strip 1A → 1, etc. — coupled entries share a post.
  const post = parseInt(program.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(post) || post < 1) return null;
  // Split field in half. Odd field sizes: middle post counted as outside.
  const insideMax = Math.floor(fieldSize / 2);
  return post <= insideMax ? "inside" : "outside";
}

export const trackBiasStrategy: Strategy = {
  id: "track-bias",
  appliesTo: ["thoroughbred"],
  name: "Same-Day Track Bias",
  thesis: "Detect inside/outside post bias from earlier races on the same track + surface, then ride horses whose tier matches the bias.",
  evaluate(race) {
    if (race.phase !== "action" && race.phase !== "chaos") return null;
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST || secondsToPost > MAX_SECONDS_TO_POST) return null;

    const live = race.runners.filter(
      r => !r.scratched && r.currentOdds > 1 && r.currentOdds < MAX_LIVE_ODDS,
    );
    if (live.length < MIN_FIELD) return null;

    // Prior results today on this track + surface, excluding the current race.
    const prior = RaceResults
      .forTrack(race.trackCode, race.surface)
      .filter(r => r.raceNumber !== race.raceNumber);
    if (prior.length < MIN_SAMPLE_RACES) return null;

    let inside = 0, outside = 0;
    for (const r of prior) {
      const t = tierOf(r.winnerProgram, r.fieldSize);
      if (t === "inside") inside++;
      else if (t === "outside") outside++;
    }
    const total = inside + outside;
    if (total < MIN_SAMPLE_RACES) return null;
    const insideShare = inside / total;
    const outsideShare = outside / total;
    let bias: Tier | null = null;
    let share = 0;
    if (insideShare >= MIN_TIER_SHARE) { bias = "inside";  share = insideShare; }
    else if (outsideShare >= MIN_TIER_SHARE) { bias = "outside"; share = outsideShare; }
    if (!bias) return null;

    const fieldSize = live.length;
    const candidates = live.filter(r => tierOf(r.program, fieldSize) === bias);
    if (!candidates.length) return null;

    const best = candidates.reduce((a, b) => b.evPercent > a.evPercent ? b : a, candidates[0]);
    if (best.evPercent < MIN_LIVE_EV) return null;

    return {
      selection: best.program,
      type: "WIN",
      evPercent: best.evPercent,
      reason: `${race.trackCode} ${race.surface}: ${inside}/${total} ${bias}-tier winners today (${Math.round(share * 100)}%) · ${best.name} at +${best.evPercent.toFixed(1)}% live EV`,
      confidence: Math.min(0.65, 0.35 + (share - 0.5)),
    };
  },
};
