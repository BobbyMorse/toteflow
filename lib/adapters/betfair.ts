import type { RacingProvider } from "../types";
// Betfair Exchange: free dev app key for non-commercial use, OAuth/session.
// Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN to enable. Endpoint:
// https://api.betfair.com/exchange/betting/json-rpc/v1
const KEY = process.env.BETFAIR_APP_KEY;
const SESSION = process.env.BETFAIR_SESSION_TOKEN;
export const betfairAdapter: RacingProvider = {
  id: "betfair",
  label: "Betfair Exchange (live)",
  status: KEY && SESSION ? "live" : "needs-key",
  notes: "Set BETFAIR_APP_KEY and BETFAIR_SESSION_TOKEN env vars to enable.",
  async listRaces() { return []; },
  async getRace() { return null; },
};
