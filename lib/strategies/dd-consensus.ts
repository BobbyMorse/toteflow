import type { Strategy, StrategyEvaluation } from "./types";
import type { Race, Runner } from "../types";
import { classifyTrack, isThoroughbred } from "../track-types";

// Daily Double — pair consecutive races at the same track when both have
// the same kind of independent +EV WIN signal (model overlay). Thesis:
// when two consecutive overlays each have decent trueP and meaningful
// WIN-pool edge, pairing them in a DD captures the multiplicative upside
// while the DD takeout (typically ~21%) only deducts once vs two separate
// WIN bets paying takeout twice.
//
// Honest limits:
//   - We don't have DD-pool data from TVG for per-combo payout, so we
//     estimate payout as fair (1/jointHit) discounted by takeout. Same
//     paper-precise caveat as exacta/trifecta/Pick-N.
//   - We don't fire if leg-2's race postTime is more than 45 min after
//     leg-1 (in case of cancellations or schedule gaps).
//   - We only consider top-1 picks per leg (single-combo DD), the cheapest
//     and clearest signal. Multi-horse caveman DDs are out of scope here.

const MIN_SECONDS_TO_LEG1 = 120;       // need time to book at the window
const MAX_LEG_GAP_MS = 45 * 60_000;
const MIN_LEG_TRUEP = 0.18;
const MIN_LEG_EV_PCT = 2;              // each leg must show ≥2% WIN-pool EV
const DD_TAKEOUT_FALLBACK = 0.21;

function bestLegPick(race: Race): { runner: Runner; truP: number; evPct: number } | null {
  if (!isThoroughbred(classifyTrack(race.trackCode, race.track))) return null;
  if (race.modelQuality !== "high") return null;
  const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60 && (r.truePWin ?? 0) > 0);
  if (live.length < 5) return null;
  // Sort by WIN-pool EV — the same signal tvg-baseline rides.
  const sorted = [...live].sort((a, b) => b.evPercent - a.evPercent);
  const top = sorted[0];
  if (top.evPercent < MIN_LEG_EV_PCT) return null;
  const truP = top.truePWin ?? 0;
  if (truP < MIN_LEG_TRUEP) return null;
  return { runner: top, truP, evPct: top.evPercent };
}

function ddTakeout(race: Race): number {
  return race.poolTakeout?.exotic ?? DD_TAKEOUT_FALLBACK;
}

export const ddConsensusStrategy: Strategy = {
  id: "dd-consensus",
  name: "Daily Double Consensus",
  thesis: "Pair top model-overlay picks in two consecutive races at the same track into a single-combo DD.",
  // Per-race entry is a no-op — DD lives entirely in the cross-race pass.
  evaluate(): StrategyEvaluation | null { return null; },
  evaluateCrossRace(races: Race[]): StrategyEvaluation[] {
    const now = Date.now();
    const out: StrategyEvaluation[] = [];

    // Group eligible races by track, then walk consecutive raceNumber pairs.
    const byTrack = new Map<string, Race[]>();
    for (const r of races) {
      const secsToPost = (r.postTime - now) / 1000;
      if (secsToPost < MIN_SECONDS_TO_LEG1) continue;   // too tight (we need leg-1 time)
      if (r.modelQuality !== "high") continue;
      const arr = byTrack.get(r.trackCode) ?? [];
      arr.push(r);
      byTrack.set(r.trackCode, arr);
    }

    for (const [trackCode, group] of byTrack) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.raceNumber - b.raceNumber);
      for (let i = 0; i < group.length - 1; i++) {
        const leg1 = group[i], leg2 = group[i + 1];
        if (leg2.raceNumber !== leg1.raceNumber + 1) continue;
        if (leg2.postTime - leg1.postTime > MAX_LEG_GAP_MS) continue;

        const p1 = bestLegPick(leg1);
        if (!p1) continue;
        const p2 = bestLegPick(leg2);
        if (!p2) continue;

        const hitProb = p1.truP * p2.truP;
        if (hitProb <= 0) continue;

        // Single-combo DD: base price = $1 (most tracks). For paper EV math
        // use that; the booker rescales by cfg.stake at fire time.
        const stake = 1;
        const takeout = ddTakeout(leg1);
        // Implied "fair" decimal price for the DD combo = 1 / hitProb. Public
        // pari-mutuel pays roughly that × (1 - takeout) in steady state.
        const fairDecimal = 1 / hitProb;
        const expectedPayout = stake * fairDecimal * (1 - takeout);
        if (expectedPayout <= stake) continue;
        const ev = (hitProb * expectedPayout / stake - 1) * 100;
        if (ev <= 0) continue;

        out.push({
          legs: [
            { raceNumber: leg1.raceNumber, selections: [p1.runner.program] },
            { raceNumber: leg2.raceNumber, selections: [p2.runner.program] },
          ],
          trackCode,
          startRaceNumber: leg1.raceNumber,
          postTime: leg1.postTime,
          type: "DD",
          evPercent: ev,
          reason:
            `DD ${trackCode} R${leg1.raceNumber}-R${leg2.raceNumber}: ` +
            `${p1.runner.name} (+${p1.evPct.toFixed(1)}% / trueP ${(p1.truP*100).toFixed(0)}%) ` +
            `→ ${p2.runner.name} (+${p2.evPct.toFixed(1)}% / trueP ${(p2.truP*100).toFixed(0)}%) ` +
            `· est hit ${(hitProb*100).toFixed(1)}% · est payout $${expectedPayout.toFixed(0)} on $${stake} (paper)`,
          confidence: Math.min(0.6, 0.3 + Math.min(p1.evPct, p2.evPct) / 20),
          estimatedPayout: expectedPayout,
          combos: 1,
        });
      }
    }
    return out;
  },
};
