import type { RacingProvider, ProviderSummary } from "../types";
import { tvgAdapter } from "./tvg";

const adapters: RacingProvider[] = [tvgAdapter];

export function listProviders(): ProviderSummary[] {
  return adapters.map(a => ({ id: a.id, label: a.label, status: a.status, notes: a.notes }));
}

export function getProvider(id: string): RacingProvider | undefined {
  return adapters.find(a => a.id === id);
}

export function liveProviders(): RacingProvider[] {
  return adapters.filter(a => a.status === "live");
}

export { tvgAdapter };
