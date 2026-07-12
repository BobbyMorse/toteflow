import type { Strategy } from "./types";
import {
  tvgBaselineStrategy,
  tvgBaselineHarnessStrategy,
  tvgBaselineQHStrategy,
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
import { variantStrategy } from "./variants";

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

export const strategies: Strategy[] = [
  ...baseStrategies,
  tvgBaselineHarnessStrategy,
  tvgBaselineQHStrategy,
  ...harnessVariants,
  ...quarterHorseVariants,
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}

export type { Strategy, StrategyConfig, StrategyEvaluation } from "./types";
