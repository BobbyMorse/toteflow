// Strategy-specific model calibrations.
//
// Only tvg-baseline recalibrates the adapter's trueP; every other strategy
// trusts the adapter's blend directly. This helper centralizes that logic so
// server (autobook) and client (tickets page) render the same numbers and
// stay in sync if the calibration ever changes.
//
// Kept out of lib/strategies/ so client code can import it without pulling
// the full strategy registry (which imports server-side deps transitively).

// Matches ADAPTER_MODEL_WEIGHT in lib/adapters/tvg.ts for "high" quality races.
const ADAPTER_MODEL_WEIGHT_HIGH = 0.65;
// Thoroughbred: 159 bets → -21% ROI at 0.65 raw weight, +12.6% ROI at 0.30
// re-blend. That's the fit that produced the "working" tvg-baseline.
const TVG_BASELINE_MODEL_WEIGHT = 0.30;
// Harness: 68 bets at 0.30 weight → -64.6% ROI. TVG's win-probability model
// was calibrated on thoroughbred races; harness pools have smaller fields
// and different price dynamics, so the model is overrating harness picks
// even after the 0.30 re-blend. Start harness at 0.15 (halving the model
// weight vs thoroughbred, doubling the pull toward market). Re-audit once
// we have another 100+ harness bets to see if this needs to go lower or
// if the strategy has any signal on harness at all.
const TVG_BASELINE_HARNESS_MODEL_WEIGHT = 0.15;
// Quarter-horse: sample too small to fit; treat like harness for now
// (short-field, non-thoroughbred). Same knob — revisit with data.
const TVG_BASELINE_QH_MODEL_WEIGHT = 0.15;
// Jumps: no bets yet — the model is flat-fit and jumps add falls/refusals/
// stamina dynamics it has never seen, so start at the most conservative
// fitted weight we have (harness's 0.15) and refit once snapshots accumulate.
const TVG_BASELINE_JUMPS_MODEL_WEIGHT = 0.15;

// Back out the adapter's pre-blend raw model P from its blended trueP, then
// re-blend at the strategy's more conservative weight.
//
// CRITICAL NOTE: The adapter's rawP from TVG is normalized across the field
// (divided by pSum) before blending. So adapterTrueP is actually a blend of
// the NORMALIZED model. When we back out rawModelP, we get the normalized
// value, not the original. This is correct - we're peeling back one layer at
// a time (blend → normalized). Clamped so degenerate inputs land in [0.005, 0.95].
function calibrateWithWeight(adapterTrueP: number, marketP: number, weight: number): number {
  const normalizedModelP = Math.max(0.005, Math.min(0.95,
    (adapterTrueP - (1 - ADAPTER_MODEL_WEIGHT_HIGH) * marketP) / ADAPTER_MODEL_WEIGHT_HIGH,
  ));
  return weight * normalizedModelP + (1 - weight) * marketP;
}

export function calibrateTVGBaselineTrueP(adapterTrueP: number, marketP: number): number {
  return calibrateWithWeight(adapterTrueP, marketP, TVG_BASELINE_MODEL_WEIGHT);
}

export function calibrateTVGBaselineHarnessTrueP(adapterTrueP: number, marketP: number): number {
  return calibrateWithWeight(adapterTrueP, marketP, TVG_BASELINE_HARNESS_MODEL_WEIGHT);
}

export function calibrateTVGBaselineQHTrueP(adapterTrueP: number, marketP: number): number {
  return calibrateWithWeight(adapterTrueP, marketP, TVG_BASELINE_QH_MODEL_WEIGHT);
}

export function calibrateTVGBaselineJumpsTrueP(adapterTrueP: number, marketP: number): number {
  return calibrateWithWeight(adapterTrueP, marketP, TVG_BASELINE_JUMPS_MODEL_WEIGHT);
}

// Strategy-aware trueP: routes by strategy id. Each tvg-baseline variant
// gets its own re-blend weight (see constants above). Anything else passes
// the adapter's value through unchanged.
export function strategyCalibratedTrueP(
  strategyId: string | null | undefined,
  adapterTrueP: number,
  marketP: number,
): number {
  if (strategyId === "tvg-baseline") return calibrateTVGBaselineTrueP(adapterTrueP, marketP);
  if (strategyId === "tvg-baseline-harness") return calibrateTVGBaselineHarnessTrueP(adapterTrueP, marketP);
  if (strategyId === "tvg-baseline-qh") return calibrateTVGBaselineQHTrueP(adapterTrueP, marketP);
  if (strategyId === "tvg-baseline-jumps") return calibrateTVGBaselineJumpsTrueP(adapterTrueP, marketP);
  return adapterTrueP;
}

// Same EV formula the adapter uses. Kept here so display code can recompute
// EV from a calibrated trueP without duplicating the arithmetic.
export function evPercentFromTrueP(trueP: number, decimalOdds: number, takeout: number): number {
  return (trueP * (decimalOdds - 1) * (1 - takeout) - (1 - trueP)) * 100;
}

// Back out the adapter's blended trueP from a stored raw EV and the fire-time
// odds. Used only to backfill legacy tvg-baseline tickets whose `capturedEV`
// was written to the raw adapter value before the strategy-calibrated capture
// landed (commit d712227). Assumes the adapter's takeout was the same as the
// value we pass in (defaults to the fallback used across the codebase).
export function adapterTruePFromRawEV(
  rawEvPercent: number,
  decimalOdds: number,
  takeout: number,
): number | null {
  if (!(decimalOdds > 1) || !(takeout >= 0 && takeout < 1)) return null;
  const e = rawEvPercent / 100;
  const denom = (decimalOdds - 1) * (1 - takeout) + 1;
  if (denom <= 0) return null;
  const p = (e + 1) / denom;
  if (!(p > 0 && p < 1)) return null;
  return p;
}

// Validate that capturedTrueP and capturedEV are mathematically consistent.
// Returns true if they match within tolerance, false if mismatched.
// This catches cases where P and EV were calculated from different odds or
// one got corrupted during save/reload.
export function validateEVConsistency(
  capturedTrueP: number | null | undefined,
  capturedEV: number | null | undefined,
  capturedOdds: number | null | undefined,
  takeout: number = 0.16,
  tolerancePct: number = 1.0, // allow 1% EV divergence due to rounding
): boolean {
  if (!capturedTrueP || capturedEV == null || !capturedOdds) return true; // can't validate without all values
  if (capturedOdds <= 1) return true; // invalid odds, can't validate

  const recomputedEV = evPercentFromTrueP(capturedTrueP, capturedOdds, takeout);
  const divergence = Math.abs(recomputedEV - capturedEV);
  return divergence <= tolerancePct;
}
