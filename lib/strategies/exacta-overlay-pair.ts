import type { Strategy, StrategyEvaluation } from "./types";
import type { Race } from "../types";

// Exacta box of the model's top two contenders, fired only when both horses
// are real value plays (positive WIN-pool EV) and both clearly outrun the
// rest of the field. Conservative: small fields and chalk-vs-chalk pairings
// are filtered out — those are precisely where the exacta pool is over-bet.
//
// Honest limits:
//   - TVG's feed doesn't expose per-combo exacta payoffs, so we estimate
//     payout from Harville top-2 joint probability and the exacta pool size
//     (minus takeout). The booker records that as `potentialPayout`; the
//     grader uses it to compute paper P/L on a hit. Paper-precise, not
//     bookable-precise.

const MIN_SECONDS_TO_POST = 90;
const MIN_FIELD = 6;
const MIN_EXACTA_POOL = 3_000;
const MIN_COMBINED_TRUEP = 0.55;   // top-2 must dominate the field
const MIN_INDIVIDUAL_TRUEP = 0.20;
const EXACTA_TAKEOUT_FALLBACK = 0.20;
const BOX_COMBOS = 2;              // 2-horse box = 2 ordered permutations

// Harville top-2 joint probability for an ordered pair (i first, j second).
// P(i 1st AND j 2nd) = p_i * p_j / (1 - p_i)
function jointTopTwo(pI: number, pJ: number): number {
  if (pI <= 0 || pJ <= 0 || pI >= 1) return 0;
  return (pI * pJ) / Math.max(0.001, 1 - pI);
}

// Estimate the per-combo exacta payoff using pari-mutuel arithmetic plus a
// public-overbets-chalk correction. Standard pari-mutuel says that under fair
// public action the expected payoff on combo (i,j) is roughly
//    pool_after_takeout / (n_total_tickets * jointTopTwo(i,j))
// We don't know n_total_tickets. We can back into it from the simplifying
// assumption that the public bets each combo roughly proportional to its
// Harville top-2 probability; that collapses to (1 - takeout) * E[payoff]
// = 1, i.e. uniformly zero-edge. The actual edge comes from the public
// overbetting chalk-on-chalk combos and underbetting two-horse pairings
// where one is a mid-price contender — captured by a small `chalkPenalty`
// applied to all-favorite pairings.
function estimateBoxPayout(
  takeout: number,
  stake: number,
  jointAB: number, jointBA: number,
  pAOdds: number, pBOdds: number,
): { hitProb: number; expectedPayout: number } {
  const hitProb = jointAB + jointBA;
  if (hitProb <= 0) return { hitProb: 0, expectedPayout: 0 };
  // Parimutuel reality: at fair pricing, expected payout per $1 wagered =
  // (1 - takeout). The OLD formula `poolAfterTake / hitProb` mistook the
  // entire pool for a single winning combo's payout — produced 10,000%+ EVs.
  // Real exotic edge requires per-combo $ data we don't have. We apply a
  // conservative overlay credit when the box is *not* chalk-on-chalk —
  // public overbets the all-favorite combo, and a diversified box collects
  // the underbet leg pairings.
  const chalkHeavy = pAOdds < 3.0 && pBOdds < 3.0;
  const overlayCredit = chalkHeavy ? 0 : 0.10; // ~10% credit on diversified boxes
  const expectedRoi = -takeout + overlayCredit;
  const expectedPayout = stake * (1 + expectedRoi);
  return { hitProb, expectedPayout };
}

function exactaTakeout(race: Race): number {
  return race.poolTakeout?.exotic ?? EXACTA_TAKEOUT_FALLBACK;
}

export const exactaOverlayPairStrategy: Strategy = {
  id: "exacta-overlay-pair",
  appliesTo: ["thoroughbred"],
  name: "Exacta Overlay Pair",
  thesis: "Box top-2 model contenders when both have +EV vs WIN pool and dominate the field. Skip chalk-on-chalk pairings (where exacta pool is overpriced).",
  evaluate(race: Race): StrategyEvaluation | null {
    if (race.modelQuality !== "high") return null;
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;

    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60 && (r.truePWin ?? 0) > 0);
    if (live.length < MIN_FIELD) return null;

    const exactaPool = race.exactaPoolTotal ?? 0;
    if (exactaPool < MIN_EXACTA_POOL) return null;

    // Top-2 by trueP. These are the model's most likely top-2 finishers.
    const sorted = [...live].sort((a, b) => (b.truePWin ?? 0) - (a.truePWin ?? 0));
    const a = sorted[0], b = sorted[1];
    const pA = a.truePWin ?? 0, pB = b.truePWin ?? 0;
    if (pA < MIN_INDIVIDUAL_TRUEP || pB < MIN_INDIVIDUAL_TRUEP) return null;
    if (pA + pB < MIN_COMBINED_TRUEP) return null;

    // Chalk-on-chalk filter: if both legs are sub-3.0 decimal (sub-2/1), the
    // exacta pool is structurally overpriced — public clusters here. Skip.
    if (a.currentOdds < 3.0 && b.currentOdds < 3.0) return null;

    // Both must show non-negative WIN-pool EV. Negative WIN EV on either leg
    // means the model says the market is rationally priced (or under) on that
    // horse — exacta edge requires positive overlay on at least the top horse
    // and not-meaningfully-negative on the partner.
    if (a.evPercent < 0) return null;
    if (b.evPercent < -2) return null;

    const takeout = exactaTakeout(race);
    const stake = 2 * BOX_COMBOS;    // assume $2 base × 2 combos = $4 ticket
    const jointAB = jointTopTwo(pA, pB);
    const jointBA = jointTopTwo(pB, pA);
    const { hitProb, expectedPayout } = estimateBoxPayout(
      takeout, stake, jointAB, jointBA, a.currentOdds, b.currentOdds,
    );
    if (hitProb <= 0 || expectedPayout <= stake) return null;
    const ev = ((expectedPayout - stake) / stake) * 100;
    if (ev <= 0) return null;

    return {
      selections: [a.program, b.program],
      type: "EXACTA",
      evPercent: ev,
      reason:
        `Exacta box ${a.name}/${b.name} — top-2 trueP ${(pA*100).toFixed(0)}%/${(pB*100).toFixed(0)}% ` +
        `(combined ${((pA+pB)*100).toFixed(0)}%) · est hit ${(hitProb*100).toFixed(1)}% ` +
        `· est payout $${expectedPayout.toFixed(0)} on $${stake} (paper)`,
      confidence: Math.min(0.6, 0.3 + (pA + pB - MIN_COMBINED_TRUEP)),
      estimatedPayout: expectedPayout,
      combos: BOX_COMBOS,
    };
  },
};
