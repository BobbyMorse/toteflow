import type { Race, Ticket } from "../types";
import type { Discipline } from "../track-types";

export interface StrategyEvaluation {
  // Single-pick wagers (WIN/PLACE/SHOW): set `selection`. The autobook stages
  // a ticket with selections = [selection].
  selection?: string;
  // Multi-pick in-race wagers (EXACTA/TRIFECTA): set `selections`. First entry
  // is the "key" horse used for optimal-timer monitoring. Selections are the
  // horses being boxed (in EXACTA, all permutations of these horses are
  // covered; in TRIFECTA, all 3-permutations).
  selections?: string[];
  // Multi-leg wagers (DD): set `legs`. raceNumber is track-local. Selections
  // per leg name the horses covered in that leg. Combos = product of leg sizes.
  // Cross-race strategies (see `evaluateCrossRace`) emit these; the autobook
  // books them directly without per-leg optimal-timer staging.
  legs?: Array<{ raceNumber: number; selections: string[] }>;
  // For cross-race legs, the trackCode (so we book the right race set).
  trackCode?: string;
  // For cross-race legs, the earliest postTime across legs — used by the UI
  // to sort/expire and by the booker to gate the fire window.
  postTime?: number;
  // For cross-race legs, the first-leg race number (so we can key the ticket
  // off the leading race like Pick-N does).
  startRaceNumber?: number;
  type: Ticket["type"];
  evPercent: number;        // strategy's own EV estimate
  // Strategy's own calibrated trueP for the selected runner. Optional; only
  // strategies that recalibrate the adapter's blend set it (tvg-baseline is
  // currently the only one). Used by autobook to store a strategy-consistent
  // capturedTrueP for the fire-time drift display.
  truePWin?: number;
  reason: string;           // short text — surfaces on ticket + log
  confidence: number;       // 0..1 — strategies may downweight low-confidence reads
  // Estimated payout if hit, in dollars. Optional; required for exotic
  // multi-leg or multi-pick wagers (no per-runner odds → no payout from
  // capturedOdds × stake). Single-pick wagers can leave this unset; the
  // booker derives potentialPayout from live odds at fire time.
  estimatedPayout?: number;
  // Total stake (dollars) that estimatedPayout was computed against. Pari-
  // mutuel payouts scale linearly with stake, so the booker rescales
  // estimatedPayout by (actualTicketStake / stakeBasis) when it books at a
  // different configured stake. Unset → booker assumes estimatedPayout was
  // computed at the actual ticket stake (no rescale).
  stakeBasis?: number;
  // For exotic wagers — number of combinations covered (e.g. 2-horse exacta
  // box = 2; 3-horse trifecta box = 6; DD = product of leg sizes).
  combos?: number;
}

export interface Strategy {
  id: string;
  name: string;
  thesis: string;
  // Which racing disciplines this strategy is designed for. The autobook filters
  // races by discipline before calling evaluate, so a thoroughbred strategy never
  // sees a harness card. Add ["harness"] or ["quarter-horse"] to build breed-
  // specific strategy groups without contaminating existing thoroughbred P&L.
  appliesTo: readonly Discipline[];
  // Per-race evaluation. Called once per visible race per tick. Returns null
  // to opt out. Single-pick wagers and in-race exotics use this path.
  evaluate(race: Race): StrategyEvaluation | null;
  // Cross-race evaluation. Called once per tick with the full race set so the
  // strategy can build multi-leg wagers (DD, etc.) that span races. Returns
  // an array of evaluations (potentially one per starting race / leg-1).
  // Strategies that don't need cross-race context can leave this unimplemented.
  evaluateCrossRace?(races: Race[]): StrategyEvaluation[];
  // When true, the promotion path requires a successful fire-time re-eval
  // whose FRESH evPercent clears the configured evThreshold — aborts the
  // staged ticket if re-eval is unavailable, endorses a different selection,
  // or the fresh edge is below threshold. For strategies whose edge is a
  // pool-composition read that can converge away between staging and off
  // (dr-z-place): the staged EV is a claim about a pool that no longer
  // exists. Opt-in only — WIN-model strategies deliberately do NOT re-gate
  // at fire (see the drift-gate removal note in autobook.ts).
  refireAtThreshold?: boolean;
}

export interface StrategyConfig {
  enabled: boolean;
  evThreshold: number;      // %
  stake: number;
  fireAtPhase: "discovery" | "action" | "chaos";
}
