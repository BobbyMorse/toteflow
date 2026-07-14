// Persist per-runner closing state for every race we watch, then stamp real
// results onto it. This is the calibration training set: (model probability,
// market odds, pool composition, outcome) for the WHOLE field of every race —
// not just the runners we bet, which are a tiny selection-biased sample.
// Enables honest refits of the model-blend weights, per-track/field-size
// calibration curves, and Stern-lambda fitting, all with out-of-sample splits.
//
// Write discipline: upsert while the race is inside the closing window,
// throttled per race — the last write before off is the closing snapshot.
// Payoffs are normalized per $1 (TVG reports them per betAmount, usually $2).
import { db } from "./db";
import type { Race } from "./types";

const PERSIST_WINDOW_MS = 5 * 60_000;   // start persisting at T-5min
const THROTTLE_MS = 30_000;             // at most one write per race per 30s
const STALE_UNSTAMPED_MS = 7 * 86_400_000; // drop never-settled rows after 7d

const lastPersist = new Map<string, number>();

const stmtUpsert = db.prepare(`
  INSERT INTO runner_snapshots (
    raceId, day, program, trackCode, raceNumber, trackType, surface, distance,
    modelQuality, fieldSize, postTime, capturedAt, odds, morningLine, truePWin,
    evPercent, winPoolAmount, placePoolAmount, showPoolAmount,
    winPoolTotal, placePoolTotal, showPoolTotal, takeout, scratched
  ) VALUES (
    @raceId, @day, @program, @trackCode, @raceNumber, @trackType, @surface, @distance,
    @modelQuality, @fieldSize, @postTime, @capturedAt, @odds, @morningLine, @truePWin,
    @evPercent, @winPoolAmount, @placePoolAmount, @showPoolAmount,
    @winPoolTotal, @placePoolTotal, @showPoolTotal, @takeout, @scratched
  )
  ON CONFLICT(raceId, day, program) DO UPDATE SET
    capturedAt      = excluded.capturedAt,
    odds            = excluded.odds,
    truePWin        = excluded.truePWin,
    evPercent       = excluded.evPercent,
    winPoolAmount   = excluded.winPoolAmount,
    placePoolAmount = excluded.placePoolAmount,
    showPoolAmount  = excluded.showPoolAmount,
    winPoolTotal    = excluded.winPoolTotal,
    placePoolTotal  = excluded.placePoolTotal,
    showPoolTotal   = excluded.showPoolTotal,
    modelQuality    = excluded.modelQuality,
    fieldSize       = excluded.fieldSize,
    scratched       = excluded.scratched
`);

const upsertRace = db.transaction((rows: Record<string, unknown>[]) => {
  for (const r of rows) stmtUpsert.run(r);
});

export function persistClosingSnapshot(race: Race): void {
  const now = Date.now();
  if (race.postTime - now > PERSIST_WINDOW_MS) return;
  const last = lastPersist.get(race.id) ?? 0;
  if (now - last < THROTTLE_MS) return;
  lastPersist.set(race.id, now);
  if (lastPersist.size > 1000) {
    for (const [k, v] of lastPersist) if (now - v > 3_600_000) lastPersist.delete(k);
  }
  const day = new Date(race.postTime).toISOString().slice(0, 10);
  const fieldSize = race.runners.filter(r => !r.scratched).length;
  const rows = race.runners.map(rn => ({
    raceId: race.id,
    day,
    program: rn.program,
    trackCode: race.trackCode,
    raceNumber: race.raceNumber,
    trackType: race.trackType ?? null,
    surface: race.surface ?? null,
    distance: race.distance ?? null,
    modelQuality: race.modelQuality ?? null,
    fieldSize,
    postTime: race.postTime,
    capturedAt: now,
    odds: rn.currentOdds ?? null,
    morningLine: rn.morningLine ?? null,
    truePWin: rn.truePWin ?? null,
    evPercent: rn.evPercent ?? null,
    winPoolAmount: rn.winPoolAmount ?? null,
    placePoolAmount: rn.placePoolAmount ?? null,
    showPoolAmount: rn.showPoolAmount ?? null,
    winPoolTotal: race.winPoolTotal ?? null,
    placePoolTotal: race.placePoolTotal ?? null,
    showPoolTotal: race.showPoolTotal ?? null,
    takeout: race.takeout > 0 ? race.takeout : null,
    scratched: rn.scratched ? 1 : 0,
  }));
  try { upsertRace(rows); } catch { /* snapshot loss is acceptable; never break the tick */ }
}

const stmtStamp = db.prepare(`
  UPDATE runner_snapshots SET
    finishPosition = @finishPosition,
    winPayoff      = @winPayoff,
    placePayoff    = @placePayoff,
    showPayoff     = @showPayoff,
    settledAt      = @settledAt
  WHERE raceId = @raceId AND program = @program
    AND settledAt IS NULL AND capturedAt >= @minCapturedAt
`);

const stampRace = db.transaction((rows: Record<string, unknown>[]) => {
  for (const r of rows) stmtStamp.run(r);
});

// Session-level guard so the grader doesn't re-run no-op UPDATEs for races
// that stay in the results feed for hours after settling.
const stamped = new Set<string>();

export function stampSnapshotResults(
  raceId: string,
  runners: Array<{
    biNumber: number;
    finishPosition: number | null;
    winPayoff: number | null;
    placePayoff: number | null;
    showPayoff: number | null;
    betAmount: number | null;
  }>,
): void {
  if (stamped.has(raceId)) return;
  stamped.add(raceId);
  if (stamped.size > 5000) stamped.clear();
  const now = Date.now();
  // Only stamp rows captured in the last 24h — raceIds recycle across days.
  const minCapturedAt = now - 24 * 3_600_000;
  const per1 = (payoff: number | null, betAmount: number | null): number | null =>
    payoff != null && betAmount != null && betAmount > 0 ? payoff / betAmount : null;
  const rows = runners.map(rn => ({
    raceId,
    program: String(rn.biNumber),
    finishPosition: rn.finishPosition ?? null,
    winPayoff: per1(rn.winPayoff, rn.betAmount),
    placePayoff: per1(rn.placePayoff, rn.betAmount),
    showPayoff: per1(rn.showPayoff, rn.betAmount),
    settledAt: now,
    minCapturedAt,
  }));
  try { stampRace(rows); } catch { /* never break the grader tick */ }
}

// Janitor: drop rows whose race never produced a result (feed gap, cancelled
// card). Stamped rows are kept forever — they're the training set.
let lastPurge = 0;
export function purgeUnstampedSnapshots(): void {
  const now = Date.now();
  if (now - lastPurge < 3_600_000) return;
  lastPurge = now;
  try {
    db.prepare("DELETE FROM runner_snapshots WHERE settledAt IS NULL AND capturedAt < ?")
      .run(now - STALE_UNSTAMPED_MS);
  } catch { /* non-critical */ }
}
