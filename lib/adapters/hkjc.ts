import type { RacingProvider, Race } from "../types";

// HKJC publishes a public race-card HTML page but the live runner+odds
// table requires real parsing. We do NOT fabricate synthetic runners —
// returning empty is more honest than fake data wearing a live flag.
// Wire real parsing into fetchMeeting() to turn this on.

async function fetchMeeting(): Promise<Race[]> {
  return [];
}

export const hkjcAdapter: RacingProvider = {
  id: "hkjc",
  label: "HKJC (parser not wired)",
  status: "needs-key",
  notes: "HTML parser unimplemented. Returning empty so no fake races leak into the app.",
  async listRaces() { return fetchMeeting(); },
  async getRace() { return null; },
};
