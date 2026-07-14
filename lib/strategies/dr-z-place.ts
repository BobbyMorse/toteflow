import type { Strategy } from "./types";
import type { Race, Runner } from "../types";

// Dr. Z place inefficiency — full Ziemba & Hausch calculation
// (Beat the Racetrack, 1984).
//
// Inputs from the tote feed: per-runner pool composition
// (Runner.winPoolAmount / placePoolAmount / showPoolAmount).
//
// Mechanics, per-bet:
//   1. Convert per-runner WIN amounts to public implied win probabilities
//      (p_i = winPoolAmount_i / sum). After takeout these still sum to 1
//      because the per-runner amounts are pre-takeout pool shares.
//   2. Use Harville's formula to estimate the probability each runner
//      finishes in the top 2.
//   3. For a place bet on horse X, the expected payoff is a function of
//      WHICH other horse is the second top-2 finisher (because the place
//      profit pool is split between exactly those two horses). Sum over j.
//   4. EV = P(X top-2) * E[payoff | top-2] - 1.
//
// Pick the highest-EV runner. Fire if the edge clears the strategy threshold
// (default 3%, configurable via the AutoBook UI).

const MIN_SECONDS_TO_POST = 15;
const MIN_FIELD = 5;
const MIN_PLACE_POOL = 5_000;          // need real liquidity for breakage math
// Ziemba's published system only bets well-backed horses (his cutoff was a
// win-pool probability around 0.15+). Two reasons: the place-pool
// inefficiency is empirically reliable on horses the crowd trusts to win but
// under-bets to place, and the Harville/Stern top-2 estimate is most accurate
// for high-probability runners — a longshot "edge" is usually pool noise, not
// mispricing. Gate applies to bet ENTRY only; closing-EV display still
// computes for the whole field.
const MIN_WIN_SHARE = 0.15;
// PLACE pool takeout: prefer the adapter's per-track value
// (race.poolTakeout.place). Falls back to race.takeout + 2pt premium, then
// to a flat US-average if neither is available.
const PLACE_PREMIUM = 0.02;
const FALLBACK_PLACE_TAKEOUT = 0.18;
export function placeTakeout(race: Race): number {
  if (race.poolTakeout?.place && race.poolTakeout.place > 0) return race.poolTakeout.place;
  if (race.takeout > 0) return race.takeout + PLACE_PREMIUM;
  return FALLBACK_PLACE_TAKEOUT;
}

// Per-runner Dr.Z PLACE EV for the whole live field. Used at closing-snapshot
// time so PLACE tickets can display closing EV the same way WIN tickets do.
// Skips runners that fail the standard evPlace guards (scratched, missing pool
// data, thin liquidity).
export function computePlaceEVs(race: Race): Record<string, number> {
  const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
  const out: Record<string, number> = {};
  if (live.length < MIN_FIELD) return out;
  const hasPoolData = live.some(r =>
    r.winPoolAmount != null && r.placePoolAmount != null,
  );
  if (!hasPoolData) return out;
  const pool = race.placePoolTotal ?? 0;
  const takeout = placeTakeout(race);
  for (const r of live) {
    const ev = evPlace(r, live, pool, takeout);
    if (ev != null) out[r.program] = ev;
  }
  return out;
}

function poolShares(runners: Runner[], key: "winPoolAmount" | "placePoolAmount" | "showPoolAmount"): Map<string, number> | null {
  let total = 0;
  for (const r of runners) {
    const v = r[key];
    if (v == null || v <= 0) continue;
    total += v;
  }
  if (total <= 0) return null;
  const out = new Map<string, number>();
  for (const r of runners) {
    const v = r[key];
    if (v == null || v <= 0) continue;
    out.set(r.program, v / total);
  }
  return out;
}

// Harville with the Stern/Henery discount. Raw Harville (P(i 2nd | j wins) =
// p_i / (1 - p_j)) assumes a beaten horse keeps its full relative strength,
// which empirically overrates favorites for 2nd place (beaten favorites often
// finish nowhere). Standard correction (Stern 1990; Lo & Bacon-Shone 1994):
// dampen win probs with an exponent < 1 before renormalizing for the
// second-place contest — fitted at ~0.81 on large HK/US samples and used in
// later editions of Ziemba's own place/show work.
const STERN_LAMBDA_2ND = 0.81;

// Returns P(horse X finishes top-2) and the conditional joint probabilities
// P(X top-2 AND j is the other top-2 finisher) for each j != X.
function topTwoJointProbs(targetProgram: string, winP: Map<string, number>): {
  pTopTwo: number;
  jointOther: Map<string, number>;
} {
  const pX = winP.get(targetProgram) ?? 0;
  // Discounted strengths for the 2nd-place contest.
  const s = new Map<string, number>();
  let S = 0;
  for (const [k, pk] of winP) {
    const v = Math.pow(Math.max(0, pk), STERN_LAMBDA_2ND);
    s.set(k, v);
    S += v;
  }
  const sX = s.get(targetProgram) ?? 0;
  const jointOther = new Map<string, number>();
  let pTopTwo = pX;  // P(X wins) already counts as top-2
  for (const [j, pj] of winP) {
    if (j === targetProgram) continue;
    const sj = s.get(j) ?? 0;
    // P(X = 1st, j = 2nd) = pX * s_j / (S - s_X)
    const pXfirst_jSecond = pX > 0 ? pX * (sj / Math.max(0.001, S - sX)) : 0;
    // P(j = 1st, X = 2nd) = pj * s_X / (S - s_j)
    const pJfirst_XSecond = pj * (sX / Math.max(0.001, S - sj));
    // P(X top-2 AND j is the other one) = sum of the two orderings
    jointOther.set(j, pXfirst_jSecond + pJfirst_XSecond);
    pTopTwo += pJfirst_XSecond;  // contribute the "X is 2nd" cases (X-wins already in pX above)
  }
  return { pTopTwo: Math.min(1, pTopTwo), jointOther };
}

// EV per $1 of placing $1 on `target` to PLACE, given the current pool
// composition. Returns null if data is insufficient.
export function evPlace(target: Runner, runners: Runner[], placePoolTotal: number, takeout: number): number | null {
  const winP = poolShares(runners, "winPoolAmount");
  if (!winP || !winP.has(target.program)) return null;

  // Amount on each horse to PLACE — needed for breakage math
  const placeAmount = new Map<string, number>();
  let placeSum = 0;
  for (const r of runners) {
    const v = r.placePoolAmount;
    if (v == null || v <= 0) continue;
    placeAmount.set(r.program, v);
    placeSum += v;
  }
  // Prefer the race-level place pool total if available — biPools per-runner
  // amounts sometimes round and won't exactly sum to it. Fall back to the sum.
  const pool = placePoolTotal > 0 ? placePoolTotal : placeSum;
  if (pool < MIN_PLACE_POOL) return null;
  const myPlace = placeAmount.get(target.program);
  if (!myPlace || myPlace <= 0) return null;

  const { pTopTwo, jointOther } = topTwoJointProbs(target.program, winP);
  if (pTopTwo <= 0) return null;

  // Conditional on X being top-2, weight payoff over which horse j is the other.
  // payoff_per_$1(j) = (pool * (1 - t) - myPlace - amount_on_j) / (2 * myPlace) + 1
  const postTake = pool * (1 - takeout);
  let expectedPayoff = 0;
  let weightSum = 0;
  for (const [j, joint] of jointOther) {
    const amtJ = placeAmount.get(j);
    if (amtJ == null || amtJ <= 0) continue;
    const profitPool = Math.max(0, postTake - myPlace - amtJ);
    const payoffPerDollar = profitPool / (2 * myPlace) + 1;
    expectedPayoff += joint * payoffPerDollar;
    weightSum += joint;
  }
  // Normalize by the joint mass we actually summed (some runners may lack
  // place amounts; we treat those as zero weight, which underestimates EV
  // slightly — conservative).
  if (weightSum <= 0) return null;
  const condEPayoff = expectedPayoff / weightSum;

  // EV: P(top-2) * E[payoff | top-2] - 1 = expected return per $1 bet
  // (positive means edge, negative means -EV)
  return (pTopTwo * condEPayoff - 1) * 100;
}

export const drZPlaceStrategy: Strategy = {
  id: "dr-z-place",
  appliesTo: ["thoroughbred"],
  name: "Dr. Z Place",
  thesis: "Place-pool mispricing: bet PLACE when win-pool prob materially exceeds place-pool prob (Ziemba & Hausch).",
  evaluate(race: Race) {
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;

    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
    if (live.length < MIN_FIELD) return null;

    // Require real per-runner pool data — no heuristic fallback. If the
    // feed doesn't expose it, the strategy stays silent rather than
    // pretending to have an edge.
    const hasPoolData = live.some(r =>
      r.winPoolAmount != null && r.placePoolAmount != null,
    );
    if (!hasPoolData) return null;

    const placePool = race.placePoolTotal ?? 0;
    const takeout = placeTakeout(race);
    const winShares = poolShares(live, "winPoolAmount");
    if (!winShares) return null;
    let best: { runner: Runner; ev: number } | null = null;
    for (const r of live) {
      if ((winShares.get(r.program) ?? 0) < MIN_WIN_SHARE) continue;
      const ev = evPlace(r, live, placePool, takeout);
      if (ev == null) continue;
      if (!best || ev > best.ev) best = { runner: r, ev };
    }
    if (!best || best.ev <= 0) return null;

    // Previously sanity-capped at +25%, but that was hiding the real model
    // output — many opportunities pinned at identical +25.0% values. Pass
    // through the raw Ziemba edge; the per-strategy evThreshold knob is
    // the right place to suppress noise.
    const ev = best.ev;

    return {
      selection: best.runner.program,
      type: "PLACE",
      evPercent: ev,
      reason: `Dr. Z PLACE ${best.runner.name} @ ${best.runner.fractionalOdds} — place pool underprices vs win pool (+${ev.toFixed(1)}%)`,
      confidence: Math.min(0.7, 0.4 + ev / 50),
    };
  },
};
