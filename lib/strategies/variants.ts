import type { Strategy } from "./types";
import type { Discipline } from "../track-types";
import type { Race, Runner } from "../types";

// Build a same-code, different-discipline variant of a base strategy.
//
// Load-bearing detail: TVG's winProbability model is calibrated on
// thoroughbred. On harness / QH the adapter's default blend (0.65 model + 0.35
// market for "high"-quality races) overrates picks by ~4x. Measured evidence:
// tvg-baseline-harness at 0.30 weight → -64.6% ROI over 68 bets (see comment
// in lib/strategy-calibration.ts). At the adapter's raw 0.65 the auto-cloned
// variants ran even hotter — track-bias-harness at -42% / 65 bets,
// tvg-baseline-harness at -88.9% before its own recalibration landed.
//
// Fix: intercept the base strategy's evaluate() and hand it a Race whose
// runners have been recalibrated for the target discipline. Recomputes each
// runner's truePWin and evPercent by unwinding the adapter's blend using the
// race's own modelQuality (so we recover the correct rawP even on medium- and
// low-quality races) and re-blending at the discipline weight. Base strategy
// code is unchanged; every downstream EV gate (thresholds, live-EV floors,
// candidate ranking) now sees the discipline-appropriate signal.

const VARIANT_MODEL_WEIGHT: Record<Discipline, number> = {
  thoroughbred: 0.65,     // adapter default — no change
  harness: 0.15,          // matches tvg-baseline-harness calibration
  "quarter-horse": 0.15,  // same as harness; revisit with data
};

function adapterWeightForQuality(quality: Race["modelQuality"]): number {
  return quality === "high" ? 0.65 : quality === "medium" ? 0.35 : 0;
}

function recalibrateRunner(r: Runner, adapterWeight: number, targetWeight: number, takeout: number): Runner {
  // Nothing to unwind: adapter used pure market (low-quality model dropped
  // out), so trueP already IS marketP — no discipline recalibration to do.
  if (adapterWeight <= 0 || r.scratched || r.currentOdds >= 60 || r.truePWin == null) return r;
  const marketP = 1 / Math.max(1.2, r.currentOdds);
  const rawModelP = Math.max(0.005, Math.min(0.95,
    (r.truePWin - (1 - adapterWeight) * marketP) / adapterWeight,
  ));
  const newTrueP = Math.max(0.005, Math.min(0.95,
    targetWeight * rawModelP + (1 - targetWeight) * marketP,
  ));
  const rawEv = (newTrueP * (r.currentOdds - 1) * (1 - takeout) - (1 - newTrueP)) * 100;
  const newEv = Math.max(-100, rawEv);
  return { ...r, truePWin: newTrueP, evPercent: newEv, evPercentRaw: rawEv };
}

function recalibrateRace(race: Race, targetWeight: number): Race {
  const adapterWeight = adapterWeightForQuality(race.modelQuality);
  if (targetWeight === adapterWeight) return race;
  const takeout = race.takeout;
  const runners = race.runners.map(r => recalibrateRunner(r, adapterWeight, targetWeight, takeout));
  return { ...race, runners };
}

export function variantStrategy(
  base: Strategy,
  opts: { discipline: Discipline; idSuffix: string; nameSuffix: string },
): Strategy {
  const weight = VARIANT_MODEL_WEIGHT[opts.discipline];
  const wrapped: Strategy = {
    ...base,
    id: `${base.id}-${opts.idSuffix}`,
    name: `${base.name} ${opts.nameSuffix}`,
    appliesTo: [opts.discipline],
    evaluate(race) {
      return base.evaluate(recalibrateRace(race, weight));
    },
  };
  if (typeof base.evaluateCrossRace === "function") {
    const crossRace = base.evaluateCrossRace.bind(base);
    wrapped.evaluateCrossRace = (races: Race[]) =>
      crossRace(races.map(r => recalibrateRace(r, weight)));
  }
  return wrapped;
}
