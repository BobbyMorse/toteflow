import type { Strategy, StrategyEvaluation } from "./types";
import type { Race } from "../types";
import { classifyTrack, isThoroughbred } from "../track-types";

// Trifecta — top-3 box of the model's strongest contenders. The thesis:
// when the model has high quality and 3 horses meaningfully separate
// from the field, a box trifecta captures the upside of any in-the-money
// order while filtering out longshot-fueled noise.
//
// Honest limits:
//   - We can't see per-combo trifecta payoffs from TVG's results feed, so
//     payout is estimated from Harville top-3 joint probability across all
//     6 orderings × the trifecta pool. Same caveat as exacta: directional,
//     not bookable-precise.
//   - 6-combo box × $0.50 base = $3 ticket at most tracks. Fires only when
//     trifecta pool is meaningful enough that the payout estimate is sane.

const MIN_SECONDS_TO_POST = 90;
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
    if (!isThoroughbred(classifyTrack(race.trackCode, race.track))) return null;
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

    // Sum Harville probability across all 6 orderings of {a,b,c}.
    let hitProb = 0;
    const ps = [pA, pB, pC];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
      if (i === j || j === k || i === k) continue;
      hitProb += jointTopThree(ps[i], ps[j], ps[k]);
    }
    if (hitProb <= 0) return null;

    const takeout = trifectaTakeout(race);
    const stake = 0.50 * BOX_COMBOS;

    // Parimutuel reality check: at fair (efficient) pricing, expected return
    // per $1 staked in any pool = (1 - takeout). The OLD formula treated the
    // ENTIRE trifecta pool as if our single winning combo collected it, which
    // produced absurd 10,000%+ EVs (real 19341% in DB row TVG-FRT-3).
    //
    // To extract real edge on an exotic we need per-combo $ data so we can
    // see where the public is mispricing. The feed doesn't expose that, so we
    // can only estimate an "overlay credit" heuristically: a chalk-light box
    // (the favorite isn't dominant and the field is genuinely competitive)
    // tends to pay better than fair on non-chalk-chalk-chalk orderings,
    // because the public overbets the chalk combo.
    //
    // Conservative credit: +12% only when the top horse is < 35% trueP AND
    // the three-horse box is broadly distributed. Otherwise no edge claim.
    const isDiverseBox = pA < 0.35 && Math.max(pA, pB, pC) - Math.min(pA, pB, pC) < 0.20;
    const overlayCredit = isDiverseBox ? 0.12 : 0;
    const expectedRoi = -takeout + overlayCredit;
    if (expectedRoi <= 0) return null;
    const ev = expectedRoi * 100;
    const expectedPayout = stake * (1 + expectedRoi);

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
      combos: BOX_COMBOS,
    };
  },
};
