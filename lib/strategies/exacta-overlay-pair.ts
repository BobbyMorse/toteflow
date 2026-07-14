import type { Strategy, StrategyEvaluation } from "./types";
import type { Race } from "../types";
import { sternHarville } from "../harville";

// Exacta box of the model's top two contenders, fired only when both horses
// are real value plays (positive WIN-pool EV) and both clearly outrun the
// rest of the field. Conservative: small fields and chalk-vs-chalk pairings
// are filtered out — those are precisely where the exacta pool is over-bet.
//
// Honest limits:
//   - TVG's feed doesn't expose per-combo exacta payoffs, so we estimate the
//     on-hit payout from the MARKET-implied Harville joint probability (WIN
//     odds, normalized) minus takeout, and the hit chance from the MODEL's
//     joint probability. The booker records the on-hit payout as
//     `potentialPayout`; the grader pays it on a hit. Paper-precise, not
//     bookable-precise.

const MIN_SECONDS_TO_POST = 15;
const MIN_FIELD = 6;
const MIN_EXACTA_POOL = 3_000;
const MIN_COMBINED_TRUEP = 0.55;   // top-2 must dominate the field
const MIN_INDIVIDUAL_TRUEP = 0.20;
const EXACTA_TAKEOUT_FALLBACK = 0.20;
const BOX_COMBOS = 2;              // 2-horse box = 2 ordered permutations

// Model-vs-market exacta box math. We don't have per-combo exacta pool data,
// so we assume the public prices each ordered combo at its MARKET-implied
// Harville probability (from WIN odds, normalized to the real probability
// scale). Under that assumption a $1 bet on ordered combo (i,j) pays
// (1 - takeout) / q_ij on a hit. Our edge is the model's joint probability
// p_ij exceeding the market's q_ij:
//   EV per $1 of box = 0.5 * (1-t) * (pAB/qAB + pBA/qBA) - 1
// (each ordering carries half the box stake). The OLD version used a flat
// "overlay credit" (+0.10) that could never beat exotic takeout (>=0.19 at
// every US track) — the strategy was mathematically unable to fire.
function estimateBoxPayout(
  takeout: number,
  stake: number,
  pAB: number, pBA: number,
  qAB: number, qBA: number,
): { hitProb: number; payoutIfHit: number; evPct: number } {
  const hitProb = pAB + pBA;
  if (hitProb <= 0 || qAB <= 0 || qBA <= 0) return { hitProb: 0, payoutIfHit: 0, evPct: -100 };
  const half = stake / 2;
  // Probability-weighted expected payout across the two orderings.
  const expectedPayout = pAB * half * (1 - takeout) / qAB
                       + pBA * half * (1 - takeout) / qBA;
  const payoutIfHit = expectedPayout / hitProb;   // conditional on hitting — what the grader pays
  const evPct = (expectedPayout / stake - 1) * 100;
  return { hitProb, payoutIfHit, evPct };
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
    const stake = 2 * BOX_COMBOS;    // $2 base × 2 combos; booker rescales via stakeBasis
    // Normalize both probability scales across the live field: model truePWin
    // sums slightly over 1 (it blends the market's takeout-inflated 1/odds),
    // and raw 1/odds sums to ~1/(1-takeout). The Stern-discounted Harville
    // (lib/harville.ts) needs real-scale probs over the WHOLE field — raw
    // Harville overrated favorite-heavy combos on both sides of the ratio.
    const pSum = live.reduce((s, r) => s + (r.truePWin ?? 0), 0);
    const qSum = live.reduce((s, r) => s + 1 / Math.max(1.2, r.currentOdds), 0);
    if (pSum <= 0 || qSum <= 0) return null;
    const psN = live.map(r => (r.truePWin ?? 0) / pSum);
    const qsN = live.map(r => (1 / Math.max(1.2, r.currentOdds)) / qSum);
    const model = sternHarville(psN);
    const market = sternHarville(qsN);
    const iA = live.indexOf(a), iB = live.indexOf(b);
    const { hitProb, payoutIfHit, evPct: ev } = estimateBoxPayout(
      takeout, stake,
      model.pair(iA, iB), model.pair(iB, iA),
      market.pair(iA, iB), market.pair(iB, iA),
    );
    if (hitProb <= 0 || ev <= 0) return null;

    return {
      selections: [a.program, b.program],
      type: "EXACTA",
      evPercent: ev,
      reason:
        `Exacta box ${a.name}/${b.name} — top-2 trueP ${(pA*100).toFixed(0)}%/${(pB*100).toFixed(0)}% ` +
        `(combined ${((pA+pB)*100).toFixed(0)}%) · est hit ${(hitProb*100).toFixed(1)}% ` +
        `· est payout $${payoutIfHit.toFixed(0)} on $${stake} (paper)`,
      confidence: Math.min(0.6, 0.3 + (pA + pB - MIN_COMBINED_TRUEP)),
      estimatedPayout: payoutIfHit,
      stakeBasis: stake,
      combos: BOX_COMBOS,
    };
  },
};
