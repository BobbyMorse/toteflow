import type { RacingProvider, ProviderSummary } from "../types";
import { hkjcAdapter } from "./hkjc";
import { equibaseAdapter } from "./equibase";
import { tvgAdapter } from "./tvg";
import { twinspiresAdapter } from "./twinspires";
import { fanduelAdapter } from "./fanduel";
import { nyraAdapter } from "./nyra";
import { amwagerAdapter } from "./amwager";
import { betfairAdapter } from "./betfair";
import { racingApiAdapter } from "./racingapi";

const adapters: RacingProvider[] = [
  hkjcAdapter,
  equibaseAdapter,
  tvgAdapter,
  twinspiresAdapter,
  fanduelAdapter,
  nyraAdapter,
  amwagerAdapter,
  betfairAdapter,
  racingApiAdapter,
];

export function listProviders(): ProviderSummary[] {
  return adapters.map(a => ({ id: a.id, label: a.label, status: a.status, notes: a.notes }));
}

export function getProvider(id: string): RacingProvider | undefined {
  return adapters.find(a => a.id === id);
}

export function liveProviders(): RacingProvider[] {
  return adapters.filter(a => a.status === "live");
}

export { tvgAdapter, hkjcAdapter, equibaseAdapter };
