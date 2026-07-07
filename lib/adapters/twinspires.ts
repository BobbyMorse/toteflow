import type { RacingProvider } from "../types";
export const twinspiresAdapter: RacingProvider = {
  id: "twinspires",
  label: "TwinSpires (scrape)",
  status: "needs-key",
  notes: "Public race pages scrapable; live odds via internal XHR. ToS risk.",
  async listRaces() { return []; },
  async getRace() { return null; },
};
