import type { Strategy } from "./types";
import type { Race, Runner } from "../types";

// Bridge-jumper SHOW fade — full pool-share detection.
//
// Bridge-jumper signature: a single runner has captured a disproportionate
// share of the show pool relative to its win-pool share. Concretely, when
// showShare(X) is meaningfully larger than winShare(X), the public's show
// money has piled onto X beyond what its win probability justifies. That
// distortion compresses the show payoffs for OTHER runners on most races
// (X hits the board) but inflates them dramatically on the ~10–20% of
// races where X misses the board.
//
// We fire when:
//   1. There's a clear bridge-jumper target (showShare >= 2.5 * winShare,
//      AND showShare >= 0.40 — i.e., one horse owns ≥40% of show pool).
//   2. Among the OTHER live runners, at least one has positive Ziemba-style
//      show EV (Harville-extended top-3 probabilities + breakage math).
//
// Bets SHOW on the highest-EV non-target runner.

const MIN_SECONDS_TO_POST = 15;
const MIN_FIELD = 7;
const MIN_SHOW_POOL = 10_000;
// SHOW pool takeout: prefer the adapter's per-track value
// (race.poolTakeout.place — SHOW shares the place-pool takeout in most US
// rate sheets). Falls back to race.takeout + 2pt premium, then to flat
// US-average if neither is available.
const SHOW_PREMIUM = 0.02;
const FALLBACK_SHOW_TAKEOUT = 0.18;
function showTakeout(race: Race): number {
  if (race.poolTakeout?.place && race.poolTakeout.place > 0) return race.poolTakeout.place;
  if (race.takeout > 0) return race.takeout + SHOW_PREMIUM;
  return FALLBACK_SHOW_TAKEOUT;
}
const BRIDGE_SHARE_RATIO = 2.5;        // showShare >= 2.5x winShare
const BRIDGE_MIN_SHOW_SHARE = 0.40;    // and >= 40% of show pool

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

// Harville-extended P(X finishes top-3) and joint probabilities for the
// other two top-3 finishers. Returns null if probabilities are degenerate.
function topThreeJoint(targetProgram: string, winP: Map<string, number>): {
  pTopThree: number;
  jointPairs: Array<{ a: string; b: string; prob: number }>;
} | null {
  const pX = winP.get(targetProgram) ?? 0;
  if (pX <= 0) return null;
  const others = Array.from(winP.entries()).filter(([k]) => k !== targetProgram);

  let pTopThree = pX;
  const jointPairs: Array<{ a: string; b: string; prob: number }> = [];

  // For each ordered pair (j, k) of distinct other runners, compute the
  // probability that the top-3 are (X, j, k) or some permutation. We
  // aggregate by unordered pair {j, k} below.
  // P(j 1st, k 2nd, X 3rd) = pj * pk/(1-pj) * pX/(1-pj-pk)
  // Sum permutations to get P(top-3 = {X, j, k}).
  const pairProb = new Map<string, number>();
  const pairAdd = (a: string, b: string, p: number) => {
    if (a > b) [a, b] = [b, a];
    const key = `${a}|${b}`;
    pairProb.set(key, (pairProb.get(key) ?? 0) + p);
  };

  for (const [j, pj] of others) {
    const denom1 = Math.max(0.001, 1 - pj);
    // P(j 1st, X 2nd) — contributes to pTopThree (X is in top-2, hence top-3 too)
    const pJ_X_2nd = pj * (pX / denom1);
    // Don't double-count: when computing top-3 prob, we sum P(X 1st)+P(X 2nd)+P(X 3rd).
    // P(X 1st) = pX (already counted). P(X 2nd) = sum_j pj * pX/(1-pj). P(X 3rd) below.
    pTopThree += pJ_X_2nd;

    for (const [k, pk] of others) {
      if (k === j) continue;
      const denom2 = Math.max(0.001, 1 - pj - pk);
      if (denom2 <= 0) continue;

      // P(j 1st, k 2nd, X 3rd) — X is 3rd, top-3 trio is {X, j, k}
      const p_j_k_X = pj * (pk / denom1) * (pX / denom2);
      pTopThree += p_j_k_X;
      pairAdd(j, k, p_j_k_X);

      // P(j 1st, X 2nd, k 3rd) — X is 2nd, top-3 trio is {X, j, k}
      const p_j_X_k = pj * (pX / denom1) * (pk / Math.max(0.001, 1 - pj - pX));
      pairAdd(j, k, p_j_X_k);

      // P(X 1st, j 2nd, k 3rd) — X is 1st, top-3 trio is {X, j, k}
      const p_X_j_k = pX * (pj / Math.max(0.001, 1 - pX)) * (pk / Math.max(0.001, 1 - pX - pj));
      pairAdd(j, k, p_X_j_k);
    }
  }

  // Convert pair probability map to array form
  for (const [key, prob] of pairProb) {
    const [a, b] = key.split("|");
    jointPairs.push({ a, b, prob });
  }
  return { pTopThree: Math.min(1, pTopThree), jointPairs };
}

// Ziemba-style SHOW EV per $1 stake.
function evShow(target: Runner, runners: Runner[], showPoolTotal: number, takeout: number): number | null {
  const winP = poolShares(runners, "winPoolAmount");
  if (!winP || !winP.has(target.program)) return null;

  const showAmount = new Map<string, number>();
  let showSum = 0;
  for (const r of runners) {
    const v = r.showPoolAmount;
    if (v == null || v <= 0) continue;
    showAmount.set(r.program, v);
    showSum += v;
  }
  const pool = showPoolTotal > 0 ? showPoolTotal : showSum;
  if (pool < MIN_SHOW_POOL) return null;
  const myShow = showAmount.get(target.program);
  if (!myShow || myShow <= 0) return null;

  const tri = topThreeJoint(target.program, winP);
  if (!tri) return null;
  const { pTopThree, jointPairs } = tri;
  if (pTopThree <= 0) return null;

  // For each pair (a, b) of other top-3 finishers, profit pool excludes
  // amounts on X, a, b. Payoff per $1 on X = profit_pool / (3 * myShow) + 1.
  const postTake = pool * (1 - takeout);
  let expectedPayoff = 0;
  let weightSum = 0;
  for (const { a, b, prob } of jointPairs) {
    const amtA = showAmount.get(a);
    const amtB = showAmount.get(b);
    if (amtA == null || amtB == null) continue;
    const profitPool = Math.max(0, postTake - myShow - amtA - amtB);
    const payoffPerDollar = profitPool / (3 * myShow) + 1;
    expectedPayoff += prob * payoffPerDollar;
    weightSum += prob;
  }
  if (weightSum <= 0) return null;
  const condEPayoff = expectedPayoff / weightSum;

  return (pTopThree * condEPayoff - 1) * 100;
}

// Find a bridge-jumper target (returns program number or null).
function findBridgeTarget(runners: Runner[]): string | null {
  const winShares = poolShares(runners, "winPoolAmount");
  const showShares = poolShares(runners, "showPoolAmount");
  if (!winShares || !showShares) return null;

  let bestProgram: string | null = null;
  let bestShowShare = 0;
  for (const [program, showShare] of showShares) {
    const winShare = winShares.get(program) ?? 0;
    if (winShare <= 0) continue;
    if (showShare < BRIDGE_MIN_SHOW_SHARE) continue;
    if (showShare < BRIDGE_SHARE_RATIO * winShare) continue;
    if (showShare > bestShowShare) {
      bestShowShare = showShare;
      bestProgram = program;
    }
  }
  return bestProgram;
}

export const bridgeJumperStrategy: Strategy = {
  id: "bridge-jumper",
  appliesTo: ["thoroughbred"],
  name: "Bridge-Jumper Show Fade",
  thesis: "SHOW the highest-EV non-target runner when a bridge-jumper has captured the show pool.",
  evaluate(race: Race) {
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;

    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
    if (live.length < MIN_FIELD) return null;

    const hasPoolData = live.some(r =>
      r.winPoolAmount != null && r.showPoolAmount != null,
    );
    if (!hasPoolData) return null;

    const bridge = findBridgeTarget(live);
    if (!bridge) return null;

    const showPool = race.showPoolTotal ?? 0;
    const takeout = showTakeout(race);
    let best: { runner: Runner; ev: number } | null = null;
    for (const r of live) {
      if (r.program === bridge) continue;
      const ev = evShow(r, live, showPool, takeout);
      if (ev == null) continue;
      if (!best || ev > best.ev) best = { runner: r, ev };
    }
    if (!best || best.ev <= 0) return null;

    const ev = best.ev;
    const bridgeRunner = live.find(r => r.program === bridge);
    const bridgeLabel = bridgeRunner ? `${bridgeRunner.name} (${bridgeRunner.fractionalOdds})` : `#${bridge}`;

    return {
      selection: best.runner.program,
      type: "SHOW",
      evPercent: ev,
      reason: `Bridge-jumper on ${bridgeLabel} — SHOW ${best.runner.name} @ ${best.runner.fractionalOdds} (+${ev.toFixed(1)}%)`,
      confidence: Math.min(0.7, 0.4 + ev / 40),
    };
  },
};
