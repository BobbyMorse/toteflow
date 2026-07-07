import type { RacingProvider } from "../types";
export const fanduelAdapter: RacingProvider = {
  id: "fanduel",
  label: "FanDuel Racing (scrape)",
  status: "needs-key",
  notes: "Same backend as TVG. No public API.",
  async listRaces() { return []; },
  async getRace() { return null; },
};
