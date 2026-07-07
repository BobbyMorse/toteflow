import type { Strategy } from "./types";

// Carryover Pick-N auto-booker. Doesn't evaluate per-race — instead, the
// autobook engine's carryover scanner picks up `CarryoverOpportunity` records
// and builds caveman tickets directly. This strategy entry exists so the
// settings UI can toggle/configure it through the same path as every other
// auto strategy. Per-race `evaluate` is a no-op.
//
// Config semantics (reusing StrategyConfig fields):
//   enabled      → on/off
//   stake        → desired base ticket cost (per combination), e.g. $0.50.
//                  The booker floors this to the wager's actual ADW/track
//                  minimum via lib/wager-minimums.ts.
//   evThreshold  → minimum carryover edge % to fire (e.g. 30 = "rawEdgePct ≥ 30")
//   fireAtPhase  → unused (we gate on minutes-to-first-leg-post instead)

export const carryoverPicknStrategy: Strategy = {
  id: "carryover-pickn",
  name: "Carryover Pick-N",
  thesis:
    "Books caveman top-2-per-leg Pick-N tickets when the scanner finds an exotic pool " +
    "with anomalous size (carryover from prior days). Fires only on high-confidence " +
    "opportunities where every leg has a trustworthy model and at least 5 minutes remain.",
  evaluate() { return null; },
};
