import type { RacingProvider } from "../types";
export const amwagerAdapter: RacingProvider = {
  id: "amwager",
  label: "AmWager (scrape)",
  status: "needs-key",
  notes: "No public API.",
  async listRaces() { return []; },
  async getRace() { return null; },
};
