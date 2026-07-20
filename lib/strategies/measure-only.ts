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
]);

export function isMeasureOnly(strategyId?: string | null): boolean {
  return !!strategyId && MEASURE_ONLY_STRATEGY_IDS.has(strategyId);
}
