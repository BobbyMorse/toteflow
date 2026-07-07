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

export const strategies: Strategy[] = [
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

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}

export type { Strategy, StrategyConfig, StrategyEvaluation } from "./types";
