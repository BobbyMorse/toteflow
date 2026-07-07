// Carryover scanner — surfaces multi-leg exotic pools (Pick 3/4/5/6/J6) that
// are anomalously large for their typical baseline. Big pools in these
// wagers usually mean a "carryover" from a prior day where no one hit it,
// which is the highest-confidence +EV setup in tote betting because the
// existing carryover money is essentially free pool you can bet into.
//
// We read real per-race pool amounts straight from the upstream tote feed
// (Race.multiLegPools). If the feed doesn't relay a Pick-N pool for a race,
// that wager isn't offered on the user's ADW — so we don't surface it.
// (Earlier versions inferred pool sizes from win-pool sums, which produced
// phantom alerts for tracks like Swedish trotting where FanDuel exposes
// only single-race wagers.)

import type { Race } from "./types";
import { liveProviders } from "./adapters";

export interface CarryoverPick {
  program: string;
  name: string;
  evPercent: number;
  fractionalOdds: string;
  truePWin?: number;
}

export interface CarryoverLeg {
  raceNumber: number;
  postTime: number;
  modelQuality: "high" | "medium" | "low";
  picks: CarryoverPick[];         // top-2 EV non-scratched runners, EV desc
  missing?: boolean;              // true when the leg race isn't in the upstream window yet
}

export interface CarryoverOpportunity {
  trackCode: string;
  trackName: string;
  startRaceNumber: number;        // first race in the sequence
  postTime: number;               // when the sequence opens
  wagerType: string;              // "P4", "P5", "P6", etc.
  wagerLabel: string;             // human-readable
  poolAmount: number;             // current pool size (real, from tote feed)
  baseline: number;               // expected pool size without carryover
  excess: number;                 // poolAmount - baseline — proxy for carryover
  confidence: "high" | "medium" | "low";
  takeoutAssumption: number;      // 0.25 typical for exotics
  rawEdgePct: number;             // rough EV uplift from the free-money fraction
  legs: CarryoverLeg[];           // per-leg EV picks for ticket construction
  // Live per-combination minimum stake from the tote feed for this wager —
  // when present, the booker must floor its configured base to this value or
  // the ticket would be rejected at place-time. undefined → fall back to the
  // static guess in lib/wager-minimums.ts.
  minWagerAmount?: number;
}

// Typical baseline pool sizes (USD) on a normal mid-week US card with no carryover.
// Heuristics — adjust as real data accumulates.
const BASELINE_BY_TYPE: Record<string, number> = {
  P3: 8_000,
  P4: 25_000,
  P5: 60_000,
  P6: 150_000,
  J6: 250_000,
};

const LABELS: Record<string, string> = {
  P3: "Pick 3",
  P4: "Pick 4",
  P5: "Pick 5",
  P6: "Pick 6",
  J6: "Jackpot Pick 6",
};

// Leg count by wager code. J6 is still 6 legs — just a jackpot variant.
const LEGS_BY_CODE: Record<string, number> = {
  P3: 3, P4: 4, P5: 5, P6: 6, J6: 6,
};

const CARRYOVER_CODES = new Set(Object.keys(BASELINE_BY_TYPE));

function buildLeg(legRace: Race | undefined, raceNumber: number): CarryoverLeg {
  if (!legRace) {
    // Leg race is past the TVG fetch window (typically Pick 5/6 final legs an
    // hour+ out). Caller still wants the slot so leg counts line up.
    return { raceNumber, postTime: 0, modelQuality: "low", picks: [], missing: true };
  }
  const ranked = legRace.runners
    .filter(r => !r.scratched && r.currentOdds < 60)
    .sort((a, b) => b.evPercent - a.evPercent);
  const picks: CarryoverPick[] = ranked.slice(0, 2).map(r => ({
    program: r.program,
    name: r.name,
    evPercent: r.evPercent,
    fractionalOdds: r.fractionalOdds,
    truePWin: r.truePWin,
  }));
  return {
    raceNumber: legRace.raceNumber,
    postTime: legRace.postTime,
    modelQuality: legRace.modelQuality ?? "low",
    picks,
  };
}

export async function detectCarryovers(): Promise<CarryoverOpportunity[]> {
  const live = liveProviders();
  const all = (await Promise.all(live.map(p => p.listRaces()))).flat();

  // Per-track race index for fast leg lookup by raceNumber.
  const byTrack = new Map<string, Map<number, Race>>();
  for (const r of all) {
    let idx = byTrack.get(r.trackCode);
    if (!idx) { idx = new Map(); byTrack.set(r.trackCode, idx); }
    idx.set(r.raceNumber, r);
  }

  // Each race carries its own multiLegPools array from the upstream feed.
  // A Pick-N sequence has the same pool dollars listed against every leg, so
  // we dedup by (track, code) and keep the entry whose race is the earliest
  // future-post — that's the leg you actually bet at.
  const best = new Map<string, { race: Race; code: string; name: string; amount: number }>();
  for (const race of all) {
    if (!race.multiLegPools?.length) continue;
    for (const pool of race.multiLegPools) {
      if (!CARRYOVER_CODES.has(pool.code)) continue;
      if (pool.amount <= 0) continue;
      const key = `${race.trackCode}:${pool.code}`;
      const existing = best.get(key);
      // Prefer the earliest upcoming leg. If pool amounts differ between legs
      // (rolling sequences with overlapping pools), keep the larger pool.
      if (!existing
        || race.postTime < existing.race.postTime
        || (race.postTime === existing.race.postTime && pool.amount > existing.amount)) {
        best.set(key, { race, code: pool.code, name: pool.name, amount: pool.amount });
      }
    }
  }

  const out: CarryoverOpportunity[] = [];
  const takeout = 0.25;
  for (const { race, code, name, amount } of best.values()) {
    const baseline = BASELINE_BY_TYPE[code] ?? 50_000;
    const excess = amount - baseline;
    if (excess <= baseline * 0.5) continue;     // need ≥50% over baseline to flag

    // Per-new-dollar EV in a carryover pool: EV = C/N - T
    //   C = carryover (untaxed, free pool)
    //   N = new money entering today = amount - C
    //   T = takeout on new money
    // Intuition: without carryover, every $1 of new money loses the takeout T.
    // The carryover boost is C/N (your share of the free pool). Net EV per $1
    // of new money is C/N - T. The OLD formula used (C/P)*(1-T), which mixes
    // total-pool fraction with takeout-adjusted edge and underestimates by a
    // factor that depends on carryoverFrac. Strategies gate on this number,
    // so the rename also re-grounds the evThreshold knob: "+15% rawEdge"
    // now means "+15% true EV per new dollar", not a nonstandard hybrid.
    const newMoney = Math.max(1, amount - Math.max(0, excess));
    const rawEdge = (Math.max(0, excess) / newMoney - takeout) * 100;
    const confidence: "high" | "medium" | "low" =
      excess > baseline * 2 ? "high" : excess > baseline ? "medium" : "low";

    const numLegs = LEGS_BY_CODE[code] ?? 0;
    const trackIdx = byTrack.get(race.trackCode);
    const legs: CarryoverLeg[] = [];
    for (let i = 0; i < numLegs; i++) {
      const legNum = race.raceNumber + i;
      legs.push(buildLeg(trackIdx?.get(legNum), legNum));
    }

    out.push({
      trackCode: race.trackCode,
      trackName: race.track,
      startRaceNumber: race.raceNumber,
      postTime: race.postTime,
      wagerType: code,
      wagerLabel: LABELS[code] ?? name ?? code,
      poolAmount: amount,
      baseline,
      excess,
      confidence,
      takeoutAssumption: takeout,
      rawEdgePct: rawEdge,
      legs,
      minWagerAmount: race.wagerMinimums?.[code]?.minWager,
    });
  }
  return out.sort((a, b) => b.rawEdgePct - a.rawEdgePct);
}
