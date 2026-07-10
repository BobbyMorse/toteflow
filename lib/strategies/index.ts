import type { Strategy } from "./types";
import { tvgBaselineStrategy } from "./tvg-baseline";
import { favFadeStrategy } from "./fav-fade";
import { overlayVsMlStrategy } from "./overlay-vs-ml";
import { lateSteamStrategy } from "./late-steam";
import { loneSpeedStrategy } from "./lone-speed";
import { passControlStrategy } from "./pass-control";
import { alwaysFavoriteStrategy } from "./always-favorite";
import { drZPlaceStrategy } from "./dr-z-place";
import { bridgeJumperStrategy } from "./bridge-jumper";
import { carryoverPicknStrategy } from "./carryover-pickn";
import { scratchBeneficiaryStrategy } from "./scratch-beneficiary";
import { trackBiasStrategy } from "./track-bias";
import { exactaOverlayPairStrategy } from "./exacta-overlay-pair";
import { trifectaKeyStrategy } from "./trifecta-key";
import { ddConsensusStrategy } from "./dd-consensus";
import { variantStrategy } from "./variants";

// Base strategies — all currently apply to thoroughbred.
const baseStrategies: Strategy[] = [
  tvgBaselineStrategy,
  favFadeStrategy,
  overlayVsMlStrategy,
  lateSteamStrategy,
  loneSpeedStrategy,
  passControlStrategy,
  alwaysFavoriteStrategy,
  drZPlaceStrategy,
  bridgeJumperStrategy,
  carryoverPicknStrategy,
  scratchBeneficiaryStrategy,
  trackBiasStrategy,
  exactaOverlayPairStrategy,
  trifectaKeyStrategy,
  ddConsensusStrategy,
];

// Per-breed variants: same code, different discipline gate. Each gets its own
// strategy config so users can toggle/tune per-breed independently and per-breed
// P&L stays isolated. Config defaults inherit from `defaultConfig()` in storage.
const harnessVariants = baseStrategies.map(base =>
  variantStrategy(base, { discipline: "harness", idSuffix: "harness", nameSuffix: "(Harness)" }),
);
const quarterHorseVariants = baseStrategies.map(base =>
  variantStrategy(base, { discipline: "quarter-horse", idSuffix: "qh", nameSuffix: "(QH)" }),
);

export const strategies: Strategy[] = [
  ...baseStrategies,
  ...harnessVariants,
  ...quarterHorseVariants,
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}

export type { Strategy, StrategyConfig, StrategyEvaluation } from "./types";
