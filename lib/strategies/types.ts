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
  // When true, the strategy's edge is re-measured against the CLOSING pool and
  // the bet only counts as real if that closing edge still clears the
  // configured evThreshold. Because drag (the gap between scheduled post and
  // the actual off) is unpredictable, we can't fire at the close — so this is
  // a SETTLEMENT gate, not a placement gate: the autobook's per-tick
  // snapshotter stamps `closingStrategyEV` (the strategy's own EV for the exact
  // bet, recomputed on the last pre-off pool it sees), and at settle the grader
  // reclassifies any ticket below threshold to SHADOW — real P&L → 0, the
  // hypothetical outcome preserved in shadowPL. For strategies whose fire-time
  // EV is systematically optimistic relative to the close (dr-z-place: place
  // pool keeps converging after fire; trifecta-key: model-vs-market edge
  // decays into the pool), so the fire number can't be the book's verdict.
  gateOnClosingEV?: boolean;
  // Recompute the strategy's OWN edge for an already-placed bet (its exact
  // selections) against a given pool — used by the autobook snapshotter to
  // stamp closingStrategyEV on the closing pool. Required when gateOnClosingEV
  // is set. Routing this through the strategy (rather than the snapshotter
  // hard-coding the math) means discipline variants recalibrate the pool the
  // same way they do for evaluate(), so the closing EV is priced at the same
  // model weight the bet fired on. Returns null when the bet can't be priced
  // against this pool (a selection scratched, pool data missing, etc.).
  closingEVFor?(race: Race, selections: readonly string[]): number | null;
  // Steam-confirmation fire gate for single-runner WIN strategies: [lo, hi]
  // as percent of stage-time odds the price must have FALLEN by fire time.
  // Below lo the ticket keeps waiting (no market confirmation yet — only
  // aborts if still below lo at the T-15s lock); above hi it aborts (the
  // crush destroyed the payout). Distinct from the removed blanket drift
  // gate: this is a strategy's explicit entry thesis (bet only when the
  // market has partially confirmed the model's pick), not a re-pricing of
  // every strategy's EV by a historical crush factor.
  fireCrushBand?: readonly [number, number];
}

export interface StrategyConfig {
  enabled: boolean;
  evThreshold: number;      // %
  stake: number;
  fireAtPhase: "discovery" | "action" | "chaos";
}
