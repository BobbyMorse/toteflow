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
//      Payoffs are what the track actually pays: our own bet joins the pool,
//      the per-$2 price is floored by dime breakage, and minus pools pay the
//      $2.10 state minimum.
//   4. EV = P(X top-2) * E[payoff | top-2] - 1.
//
// Ziemba's protocol bets as LATE as possible (his published runs computed at
// ~2 minutes to post) and only on expected return ≥ 1.14 — the margin that
// survives breakage and late pool convergence. Both matter here: the first
// 14 settled bets of the naive version (3% threshold, stage-time EV) all
// fired positive and 13/14 were negative-EV by race-off, for -22% ROI. The
// "inefficiency" in an immature place pool is mostly fill-lag, not
// mispricing. Hence: pool-maturity gate below, evaluation stays callable
// through the drag window so the autobook re-prices at fire time, and
// `refireAtThreshold` makes the fresh fire-time edge the binding gate.

// Evaluation window: no lower bound before post (fires happen IN drag — the
// window between scheduled post and actual off — and the promotion path
// re-runs evaluate() there; a lower bound like the old T-15s gate made that
// re-eval return null, so tickets fired on their stale stage-time EV). Only
// cut off when we're past any plausible drag, i.e. the feed is stale
// (optimal-timer aborts at 90s; margin on top of that).
const EVAL_MAX_DRAG_SECONDS = 120;
const MIN_FIELD = 5;
const MIN_PLACE_POOL = 5_000;          // need real liquidity for breakage math
// Pool maturity: place pools fill later than win pools, and late place money
// lands disproportionately on well-backed horses — exactly the runners
// MIN_WIN_SHARE restricts us to. An "underpriced" place share in a pool that
// is still mostly empty is fill-lag wearing an edge costume. US thoroughbred
// place pools settle around 35-50% of the win pool; require at least 25%
// before trusting the win-vs-place ratio at all.
const MIN_PLACE_TO_WIN_RATIO = 0.25;
// Flat paper stake modeled into the payoff (our bet joins the pool and
// dilutes the imbalance we're betting on — Ziemba's formulas include it).
// Flat $20 across strategies by policy; not a sizing knob.
const BET_SIZE = 20;
// What the track actually pays per $2: profit rounded DOWN to the next dime
// (breakage), and never below the $2.10 state-minimum price (minus pools).
// On chalk place prices the theoretical payoff sits at $2.10-$2.40, so
// breakage alone can eat a several-percent "edge" — quoting un-broken
// payoffs is how the naive version manufactured +EV that no track pays.
const MIN_PLACE_PRICE = 2.10;
const BREAKAGE_INCREMENT = 0.10;

// Convert a theoretical per-$1 payoff into the per-$1 payoff the track pays
// after dime breakage and the minimum-price floor.
function breakagePayoff(payoffPerDollar: number): number {
  const price2 = Math.floor((payoffPerDollar * 2) / BREAKAGE_INCREMENT + 1e-9) * BREAKAGE_INCREMENT;
  return Math.max(MIN_PLACE_PRICE, price2) / 2;
}
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

// EV per $1 of a `betSize` PLACE bet on `target`, given the current pool
// composition. Models the bet's own pool impact, dime breakage, and the
// $2.10 minimum price. Returns null if data is insufficient.
export function evPlace(target: Runner, runners: Runner[], placePoolTotal: number, takeout: number, betSize = BET_SIZE): number | null {
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
  // Our bet is IN the pool it's paid from: it inflates the total and our
  // runner's place amount, diluting the imbalance we detected. Then breakage:
  // payoff_per_$1(j) = breakage(((pool+bet)(1-t) - (myPlace+bet) - amount_on_j) / (2(myPlace+bet)) + 1)
  const postTake = (pool + betSize) * (1 - takeout);
  const myTotal = myPlace + betSize;
  let expectedPayoff = 0;
  let weightSum = 0;
  for (const [j, joint] of jointOther) {
    const amtJ = placeAmount.get(j);
    if (amtJ == null || amtJ <= 0) continue;
    const profitPool = Math.max(0, postTake - myTotal - amtJ);
    const payoffPerDollar = breakagePayoff(profitPool / (2 * myTotal) + 1);
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
  // The edge is a pool-composition read that converges away right up to off —
  // the fire-time re-eval, not the staged snapshot, must clear the threshold.
  refireAtThreshold: true,
  // ...and even the fire-time re-eval is early relative to the close: place
  // pools fill disproportionately in the final seconds, so a bet that clears
  // +14% at fire routinely decays to a few percent by off (the realized ROI
  // tracks the close, not the fire). Re-measure the Dr.Z place EV against the
  // closing pool and only bank bets that still clear threshold there.
  gateOnClosingEV: true,
  // Closing gate: re-run the Dr.Z place EV for our exact horse against the
  // closing pool. Pool amounts (not truePWin) drive this, so discipline
  // recalibration is a no-op here — but going through the strategy keeps the
  // gate uniform across strategies.
  closingEVFor(race: Race, selections: readonly string[]): number | null {
    const sel = selections[0];
    if (!sel) return null;
    const v = computePlaceEVs(race)[sel];
    return v == null ? null : v;
  },
  evaluate(race: Race) {
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    // Stale-feed cutoff only. No lower bound — the promotion path re-runs
    // this in the drag window and the fresh result is the binding gate.
    if (secondsToPost < -EVAL_MAX_DRAG_SECONDS) return null;

    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
    if (live.length < MIN_FIELD) return null;

    // Require real per-runner pool data — no heuristic fallback. If the
    // feed doesn't expose it, the strategy stays silent rather than
    // pretending to have an edge.
    const hasPoolData = live.some(r =>
      r.winPoolAmount != null && r.placePoolAmount != null,
    );
    if (!hasPoolData) return null;

    const placePoolSum = live.reduce((a, r) => a + (r.placePoolAmount ?? 0), 0);
    const placePool = (race.placePoolTotal ?? 0) > 0 ? race.placePoolTotal! : placePoolSum;
    // Pool maturity gate — see MIN_PLACE_TO_WIN_RATIO. A win/place imbalance
    // measured before the place pool has substantially filled is fill-lag,
    // not mispricing; it reliably vanishes by off.
    if (race.winPoolTotal > 0 && placePool < MIN_PLACE_TO_WIN_RATIO * race.winPoolTotal) return null;
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
      // fractionalOdds here is the WIN price — it's the strategy's signal (a
      // well-backed win favorite the crowd under-bets to place), NOT what this
      // PLACE bet pays. Label it as the win-pool price so the ticket doesn't
      // read as "place @ 1/1" (place never pays the win odds).
      reason: `Dr. Z PLACE ${best.runner.name} — ${best.runner.fractionalOdds} win favorite the place pool underprices (+${ev.toFixed(1)}%)`,
      confidence: Math.min(0.7, 0.4 + ev / 50),
    };
  },
};
