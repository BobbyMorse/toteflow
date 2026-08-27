// Measure-only strategy IDs — strategies whose every bet is booked as a $0
// shadow by design (real stake/P&L stay 0; the hypothetical result lives in
// shadowPL). They never touch the bankroll, so their bankroll-true row is
// permanently "0 settled / $0" — the real record is the shadowed slice.
//
// This is a client-safe mirror of the `measureOnly` flag on the strategy
// definitions (see lib/strategies/pure-steam.ts) so ticket rows and the
// analytics page can label these without importing the full strategy graph
// into the client bundle. Kept in sync with the registry by an assertion in
// ./index.ts — add a measure-only strategy and you must add its id here too.
export const MEASURE_ONLY_STRATEGY_IDS: ReadonlySet<string> = new Set([
  "pure-steam",
  // tvg-steam-overbet-guard is a negative control (fires on horses whose value
  // has evaporated) — it must never book real. The other steam variants and the
  // late scanners book major edges real (realEVFloor), so they are NOT here.
  "tvg-steam-overbet-guard",
  // Longshot steam variants — subsets of tvg-steam picks, run as pure parallel
  // measurement (they'd bankroll-dedup to shadow anyway). See tvg-baseline.ts.
  "tvg-steam-longshot",
  "tvg-steam-longshot-strict",
]);

export function isMeasureOnly(strategyId?: string | null): boolean {
  return !!strategyId && MEASURE_ONLY_STRATEGY_IDS.has(strategyId);
}
