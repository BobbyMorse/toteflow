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
// Matches MODEL_WEIGHT in lib/strategies/tvg-baseline.ts.
const TVG_BASELINE_MODEL_WEIGHT = 0.30;

// Back out the adapter's pre-blend raw model P from its blended trueP, then
// re-blend at the strategy's more conservative weight. Clamped like the
// adapter clamps so degenerate inputs land in [0.005, 0.95].
export function calibrateTVGBaselineTrueP(adapterTrueP: number, marketP: number): number {
  const rawModelP = Math.max(0.005, Math.min(0.95,
    (adapterTrueP - (1 - ADAPTER_MODEL_WEIGHT_HIGH) * marketP) / ADAPTER_MODEL_WEIGHT_HIGH,
  ));
  return TVG_BASELINE_MODEL_WEIGHT * rawModelP + (1 - TVG_BASELINE_MODEL_WEIGHT) * marketP;
}

// Strategy-aware trueP: for tvg-baseline, recalibrate; for anything else,
// pass the adapter's value through. `marketP` should be the 1/decimalOdds
// implied probability at the moment of evaluation.
export function strategyCalibratedTrueP(
  strategyId: string | null | undefined,
  adapterTrueP: number,
  marketP: number,
): number {
  if (strategyId === "tvg-baseline") return calibrateTVGBaselineTrueP(adapterTrueP, marketP);
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
