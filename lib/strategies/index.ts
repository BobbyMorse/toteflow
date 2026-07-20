import type { Strategy } from "./types";
import {
  tvgBaselineStrategy,
  tvgBaselineHarnessStrategy,
  tvgBaselineQHStrategy,
  tvgBaselineJumpsStrategy,
  tvgSteamStrategy,
  tvgSteamHarnessStrategy,
} from "./tvg-baseline";
import { favFadeStrategy } from "./fav-fade";
import { loneSpeedStrategy } from "./lone-speed";
import { passControlStrategy } from "./pass-control";
import { alwaysFavoriteStrategy } from "./always-favorite";
import { drZPlaceStrategy } from "./dr-z-place";
import { bridgeJumperStrategy } from "./bridge-jumper";
import { carryoverPicknStrategy } from "./carryover-pickn";
import { trackBiasStrategy } from "./track-bias";
import { exactaOverlayPairStrategy } from "./exacta-overlay-pair";
import { trifectaKeyStrategy } from "./trifecta-key";
import { ddConsensusStrategy } from "./dd-consensus";
import { pureSteamStrategy } from "./pure-steam";
import { variantStrategy } from "./variants";
import { MEASURE_ONLY_STRATEGY_IDS } from "./measure-only";

// Base strategies — all currently apply to thoroughbred. tvg-baseline is
// excluded from the auto-variant map because its harness/QH versions need
// different model-blend weights (see lib/strategy-calibration.ts) and are
// hand-built alongside the thoroughbred version in tvg-baseline.ts.
const baseStrategies: Strategy[] = [
  tvgBaselineStrategy,
  favFadeStrategy,
  loneSpeedStrategy,
  passControlStrategy,
  alwaysFavoriteStrategy,
  drZPlaceStrategy,
  bridgeJumperStrategy,
  carryoverPicknStrategy,
  trackBiasStrategy,
  exactaOverlayPairStrategy,
  trifectaKeyStrategy,
  ddConsensusStrategy,
];

// Per-breed variants: same code, different discipline gate. Each gets its own
// strategy config so users can toggle/tune per-breed independently and per-breed
// P&L stays isolated. Config defaults inherit from `defaultConfig()` in storage.
const variantable = baseStrategies.filter(s => s.id !== "tvg-baseline");
const harnessVariants = variantable.map(base =>
  variantStrategy(base, { discipline: "harness", idSuffix: "harness", nameSuffix: "(Harness)" }),
);
const quarterHorseVariants = variantable.map(base =>
  variantStrategy(base, { discipline: "quarter-horse", idSuffix: "qh", nameSuffix: "(QH)" }),
);
const jumpsVariants = variantable.map(base =>
  variantStrategy(base, { discipline: "jumps", idSuffix: "jumps", nameSuffix: "(Jumps)" }),
);

export const strategies: Strategy[] = [
  ...baseStrategies,
  tvgBaselineHarnessStrategy,
  tvgBaselineQHStrategy,
  tvgBaselineJumpsStrategy,
  tvgSteamStrategy,
  tvgSteamHarnessStrategy,
  // Measure-only control — not variant-expanded; one thoroughbred experiment.
  pureSteamStrategy,
  ...harnessVariants,
  ...quarterHorseVariants,
  ...jumpsVariants,
];

// Keep the client-safe MEASURE_ONLY_STRATEGY_IDS mirror honest: it must match
// exactly the strategies that declare `measureOnly`. Fail loudly at load if they
// drift so a new measure-only strategy can't silently render as a dead $0 row.
{
  const registryMeasureOnly = new Set(strategies.filter(s => s.measureOnly).map(s => s.id));
  for (const id of registryMeasureOnly) {
    if (!MEASURE_ONLY_STRATEGY_IDS.has(id)) {
      throw new Error(`measureOnly strategy "${id}" is missing from MEASURE_ONLY_STRATEGY_IDS (lib/strategies/measure-only.ts)`);
    }
  }
  for (const id of MEASURE_ONLY_STRATEGY_IDS) {
    if (!registryMeasureOnly.has(id)) {
      throw new Error(`MEASURE_ONLY_STRATEGY_IDS lists "${id}" but no strategy with that id declares measureOnly`);
    }
  }
}

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}

export type { Strategy, StrategyConfig, StrategyEvaluation } from "./types";
