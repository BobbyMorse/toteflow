import type { Strategy, StrategyEvaluation } from "./types";
import type { Race } from "../types";
import { sternHarville } from "../harville";

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

function trifectaTakeout(race: Race): number {
  return race.poolTakeout?.exotic ?? TRIFECTA_TAKEOUT_FALLBACK;
}

export interface TrifectaBox {
  selections: [string, string, string];
  ev: number;              // EV% of the box at the pool this was computed against
  hitProb: number;         // model prob all three fill the top-3 (any order)
  expectedPayout: number;  // on-hit payout for `stake` (paper)
  top3: [number, number, number];  // trueP of the three boxed horses
}

// Core box math, factored out of evaluate() so it can be re-run against the
// CLOSING pool for gateOnClosingEV. Computes the model-vs-market box EV for a
// SPECIFIC trio (when `forced` is given — the exact horses a live ticket
// boxed) or the model's own top-3 (when omitted). No time/quality/pool gates
// here — the caller applies those; this is pure pricing over whatever pool the
// race currently exposes. Returns null when the trio can't be priced (a boxed
// horse scratched or fell off the feed, field too small, degenerate market).
export function trifectaBoxEV(race: Race, forced?: readonly string[]): TrifectaBox | null {
  const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60 && (r.truePWin ?? 0) > 0);
  if (live.length < 3) return null;

  let a, b, c;
  if (forced && forced.length === 3) {
    a = live.find(r => r.program === forced[0]);
    b = live.find(r => r.program === forced[1]);
    c = live.find(r => r.program === forced[2]);
    if (!a || !b || !c) return null;   // a boxed horse is gone at close → can't price
  } else {
    const sorted = [...live].sort((x, y) => (y.truePWin ?? 0) - (x.truePWin ?? 0));
    [a, b, c] = sorted;
    if (!a || !b || !c) return null;
  }

  const takeout = trifectaTakeout(race);
  const stake = 0.50 * BOX_COMBOS;

  const pSum = live.reduce((s, r) => s + (r.truePWin ?? 0), 0);
  const qSum = live.reduce((s, r) => s + 1 / Math.max(1.2, r.currentOdds), 0);
  if (pSum <= 0 || qSum <= 0) return null;
  const psN = live.map(r => (r.truePWin ?? 0) / pSum);
  const qsN = live.map(r => (1 / Math.max(1.2, r.currentOdds)) / qSum);
  const model = sternHarville(psN);
  const market = sternHarville(qsN);
  const idx = [live.indexOf(a), live.indexOf(b), live.indexOf(c)];

  let hitProb = 0;
  let expectedReturn = 0;
  const perCombo = 1 / BOX_COMBOS;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
    if (i === j || j === k || i === k) continue;
    const pO = model.triple(idx[i], idx[j], idx[k]);
    const qO = market.triple(idx[i], idx[j], idx[k]);
    if (qO <= 0) continue;
    hitProb += pO;
    expectedReturn += pO * perCombo * (1 - takeout) / qO;
  }
  if (hitProb <= 0) return null;

  const ev = (expectedReturn - 1) * 100;
  const expectedPayout = stake * expectedReturn / hitProb;
  return {
    selections: [a.program, b.program, c.program],
    ev,
    hitProb,
    expectedPayout,
    top3: [a.truePWin ?? 0, b.truePWin ?? 0, c.truePWin ?? 0],
  };
}

export const trifectaKeyStrategy: Strategy = {
  id: "trifecta-key",
  appliesTo: ["thoroughbred"],
  name: "Trifecta Top-3 Box",
  thesis: "Box the model's top 3 contenders when they meaningfully outrun the field — any in-the-money order pays.",
  // Both sides of this strategy's EV — the box hit probability AND the payout —
  // are model-derived (the TVG feed exposes no per-combo trifecta payoffs), and
  // the model-vs-market edge decays into the pool by post. Fire EV runs strongly
  // positive while close EV goes negative. Re-price the exact boxed trio against
  // the closing pool (trifectaBoxEV) and only bank bets whose edge survives.
  gateOnClosingEV: true,
  // Closing gate: re-price the exact boxed trio against the closing pool. Runs
  // through variantStrategy's recalibration so harness/QH/jumps tickets are
  // priced at the same model weight they fired on.
  closingEVFor(race: Race, selections: readonly string[]): number | null {
    if (selections.length < 3) return null;
    return trifectaBoxEV(race, selections.slice(0, 3))?.ev ?? null;
  },
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

    // Model-vs-market box math (see trifectaBoxEV). Same approach as
    // exacta-overlay-pair: the public prices each ordered triple at its
    // market-implied Stern-Harville probability q_o; edge is the model's p_o
    // exceeding q_o, summed over the 6 orderings, net of exotic takeout.
    const box = trifectaBoxEV(race, [a.program, b.program, c.program]);
    if (!box || box.ev <= 0) return null;
    const { ev, hitProb, expectedPayout } = box;
    const stake = 0.50 * BOX_COMBOS;   // $0.50 base × 6 combos; booker rescales via stakeBasis

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
