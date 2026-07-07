import type { RacingProvider } from "../types";
export const nyraAdapter: RacingProvider = {
  id: "nyra",
  label: "NYRA Bets (scrape)",
  status: "needs-key",
  notes: "Public race pages at nyra.com; XHR for live odds. ToS risk.",
  async listRaces() { return []; },
  async getRace() { return null; },
};
