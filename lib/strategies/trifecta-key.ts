import type { Strategy, StrategyEvaluation } from "./types";
import type { Race } from "../types";

// Trifecta — top-3 box of the model's strongest contenders. The thesis:
// when the model has high quality and 3 horses meaningfully separate
// from the field, a box trifecta captures the upside of any in-the-money
// order while filtering out longshot-fueled noise.
//
// Honest limits:
//   - We can't see per-combo trifecta payoffs from TVG's results feed, so
//     the on-hit payout is estimated from the MARKET-implied Harville
//     probability of each ordering (WIN odds, normalized) minus takeout,
//     and the hit chance from the MODEL's Harville probability. Same caveat
//     as exacta: directional, not bookable-precise.
//   - 6-combo box × $0.50 base = $3 ticket at most tracks. Fires only when
//     trifecta pool is meaningful enough that the payout estimate is sane.

const MIN_SECONDS_TO_POST = 15;
const MIN_FIELD = 7;
const MIN_TRIFECTA_POOL = 3_000;
const MIN_TOP3_COMBINED_TRUEP = 0.65;
const MIN_INDIVIDUAL_TRUEP = 0.10;
const TRIFECTA_TAKEOUT_FALLBACK = 0.22;
const BOX_COMBOS = 6;              // 3-horse box = 6 orderings

// Harville top-3 joint probability for ordered triple (i,j,k):
//   P(i 1st, j 2nd, k 3rd) = p_i * (p_j / (1 - p_i)) * (p_k / (1 - p_i - p_j))
function jointTopThree(pI: number, pJ: number, pK: number): number {
  if (pI <= 0 || pJ <= 0 || pK <= 0) return 0;
  if (pI >= 1) return 0;
  const denom2 = 1 - pI;
  if (denom2 <= 0) return 0;
  const denom3 = 1 - pI - pJ;
  if (denom3 <= 0) return 0;
  return pI * (pJ / denom2) * (pK / denom3);
}

function trifectaTakeout(race: Race): number {
  return race.poolTakeout?.exotic ?? TRIFECTA_TAKEOUT_FALLBACK;
}

export const trifectaKeyStrategy: Strategy = {
  id: "trifecta-key",
  appliesTo: ["thoroughbred"],
  name: "Trifecta Top-3 Box",
  thesis: "Box the model's top 3 contenders when they meaningfully outrun the field — any in-the-money order pays.",
  evaluate(race: Race): StrategyEvaluation | null {
    if (race.modelQuality !== "high") return null;
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;

    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60 && (r.truePWin ?? 0) > 0);
    if (live.length < MIN_FIELD) return null;
    if ((race.trifectaPoolTotal ?? 0) < MIN_TRIFECTA_POOL) return null;

    const sorted = [...live].sort((a, b) => (b.truePWin ?? 0) - (a.truePWin ?? 0));
    const [a, b, c] = sorted;
    const pA = a.truePWin ?? 0, pB = b.truePWin ?? 0, pC = c.truePWin ?? 0;
    if (pA < MIN_INDIVIDUAL_TRUEP || pB < MIN_INDIVIDUAL_TRUEP || pC < MIN_INDIVIDUAL_TRUEP) return null;
    if (pA + pB + pC < MIN_TOP3_COMBINED_TRUEP) return null;

    const takeout = trifectaTakeout(race);
    const stake = 0.50 * BOX_COMBOS;   // $0.50 base × 6 combos; booker rescales via stakeBasis

    // Model-vs-market box math (same approach as exacta-overlay-pair). We
    // assume the public prices each ordered triple at its MARKET-implied
    // Harville probability q_o (from WIN odds, normalized to the real
    // probability scale), so a hit on ordering o pays (stake/6)·(1-t)/q_o.
    // Edge = model Harville p_o exceeding q_o, summed over the 6 orderings:
    //   EV per $1 = (1/6)·(1-t)·Σ (p_o / q_o) - 1
    // The OLD version used a flat "+12% overlay credit" that could never
    // beat exotic takeout (>= 0.19 at every US track) — the strategy was
    // mathematically unable to fire. Before that, treating the whole pool
    // as one combo's payout produced 10,000%+ EVs. Both wrong.
    const pSum = live.reduce((s, r) => s + (r.truePWin ?? 0), 0);
    const qSum = live.reduce((s, r) => s + 1 / Math.max(1.2, r.currentOdds), 0);
    if (pSum <= 0 || qSum <= 0) return null;
    const ps = [pA / pSum, pB / pSum, pC / pSum];
    const qs = [a, b, c].map(r => (1 / Math.max(1.2, r.currentOdds)) / qSum);

    let hitProb = 0;
    let expectedReturn = 0;   // probability-weighted payout per $1 of ticket
    const perCombo = 1 / BOX_COMBOS;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
      if (i === j || j === k || i === k) continue;
      const pO = jointTopThree(ps[i], ps[j], ps[k]);
      const qO = jointTopThree(qs[i], qs[j], qs[k]);
      if (qO <= 0) continue;
      hitProb += pO;
      expectedReturn += pO * perCombo * (1 - takeout) / qO;
    }
    if (hitProb <= 0) return null;

    const ev = (expectedReturn - 1) * 100;
    if (ev <= 0) return null;
    const expectedPayout = stake * expectedReturn / hitProb;   // on-hit payout — what the grader pays

    return {
      selections: [a.program, b.program, c.program],
      type: "TRIFECTA",
      evPercent: ev,
      reason:
        `Trifecta box ${a.name}/${b.name}/${c.name} — top-3 trueP ` +
        `${(pA*100).toFixed(0)}/${(pB*100).toFixed(0)}/${(pC*100).toFixed(0)}% ` +
        `(combined ${((pA+pB+pC)*100).toFixed(0)}%) · est hit ${(hitProb*100).toFixed(1)}% ` +
        `· est payout $${expectedPayout.toFixed(0)} on $${stake} (paper)`,
      confidence: Math.min(0.55, 0.3 + (pA + pB + pC - MIN_TOP3_COMBINED_TRUEP)),
      estimatedPayout: expectedPayout,
      stakeBasis: stake,
      combos: BOX_COMBOS,
    };
  },
};
