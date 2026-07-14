// Fire-to-close odds drift on WINNING tickets, learned from our own settled
// history. Empirically (2026-07 audit) winners' odds shorten ~20% between
// fire and close while losers' drift ~0 — late smart money lands on the same
// horses we pick. Pari-mutuel pays the CLOSING price, so an EV gate computed
// at fire-time odds systematically overstates the value of a winning bet.
// The promote gate re-prices EV at drift-adjusted odds before firing.
//
// Per-strategy median of closingOdds/capturedOdds over won WIN tickets,
// falling back to the global winner median, falling back to 1 (no adjustment)
// until enough winners exist. Clamped to [0.6, 1.0]: never adjust odds UP
// (drift out would raise EV — stay conservative), never haircut below 40%.
// WIN pools only — PLACE/SHOW payoff dynamics differ and aren't modeled here.
import { db } from "./db";

const MIN_WINNERS = 10;
const CACHE_MS = 10 * 60_000;
const CLAMP_LOW = 0.6;
const CLAMP_HIGH = 1.0;

const Q_WINNER_RATIOS = db.prepare(`
  SELECT strategyId, closingOdds / capturedOdds AS ratio
  FROM tickets
  WHERE status = 'won' AND type = 'WIN'
    AND capturedOdds > 1 AND closingOdds > 1
    AND strategyId IS NOT NULL AND stake > 0
`);

let cache: { at: number; byStrategy: Map<string, number>; global: number } | null = null;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function refresh(): NonNullable<typeof cache> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache;
  const rows = Q_WINNER_RATIOS.all() as Array<{ strategyId: string; ratio: number }>;
  const grouped = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    if (!(r.ratio > 0)) continue;
    const arr = grouped.get(r.strategyId) ?? [];
    arr.push(r.ratio);
    grouped.set(r.strategyId, arr);
    all.push(r.ratio);
  }
  const byStrategy = new Map<string, number>();
  for (const [id, ratios] of grouped) {
    if (ratios.length >= MIN_WINNERS) byStrategy.set(id, median(ratios));
  }
  const global = all.length >= MIN_WINNERS ? median(all) : 1;
  cache = { at: now, byStrategy, global };
  return cache;
}

// Multiply fire-time odds by this factor to estimate the odds a winning bet
// will actually be paid at.
export function winnerOddsDriftFactor(strategyId: string | null | undefined): number {
  const { byStrategy, global } = refresh();
  const f = (strategyId ? byStrategy.get(strategyId) : undefined) ?? global;
  return Math.min(CLAMP_HIGH, Math.max(CLAMP_LOW, f));
}
