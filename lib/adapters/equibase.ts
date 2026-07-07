import type { RacingProvider, Race } from "../types";

// Equibase publishes entries on www.equibase.com/static/entry/.
// We scaffold the adapter but do NOT scrape by default — it requires per-track
// HTML parsing that's fragile. Hook your parser into `fetchEntries()` to enable.

export const equibaseAdapter: RacingProvider = {
  id: "equibase",
  label: "Equibase entries (scrape)",
  status: "needs-key",
  notes: "Scrape adapter. Implement parser in lib/adapters/equibase.ts → fetchEntries().",
  async listRaces(): Promise<Race[]> { return []; },
  async getRace() { return null; },
};
