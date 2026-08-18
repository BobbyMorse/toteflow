// Durable per-runner odds TRAJECTORY for every race we watch. Companion to
// runner-snapshots.ts: that table keeps a single closing row per runner (the
// calibration training set); THIS table keeps the whole pre-off price path —
// the ordered {t, odds} points as they moved into post — plus the result.
//
// Why it exists: the steam thesis is about the PATH, not the endpoint. "Did
// 8→4 beat a horse that sat at 4 the whole time?" can only be answered with the
// trajectory, and the live source (Runner.oddsHistory) is in-memory only (≤60
// change-points, lost on restart). We persist it here so the tvg-steam variants
// can eventually be backtested against real timestamped movement instead of a
// single crush number.
//
// Write discipline mirrors runner-snapshots: upsert while the race is inside the
// closing window, throttled per race, last write before off wins (oddsHistory
// accumulates, so the final write carries the fullest recent path). The grader
// stamps finishPosition + per-$1 payoffs when the result arrives. Payoffs are
// normalized per $1 (TVG reports them per betAmount, usually $2).
import { db } from "./db";
import type { Race } from "./types";

const PERSIST_WINDOW_MS = 5 * 60_000;   // start persisting at T-5min
const THROTTLE_MS = 30_000;             // at most one write per race per 30s
const STALE_UNSTAMPED_MS = 7 * 86_400_000; // drop never-settled rows after 7d

const lastPersist = new Map<string, number>();

const stmtUpsert = db.prepare(`
  INSERT INTO odds_trajectory (
    raceId, day, program, trackCode, raceNumber, trackType,
    modelQuality, fieldSize, postTime, capturedAt, truePWin,
    openOdds, closeOdds, pointCount, trajectory
  ) VALUES (
    @raceId, @day, @program, @trackCode, @raceNumber, @trackType,
    @modelQuality, @fieldSize, @postTime, @capturedAt, @truePWin,
    @openOdds, @closeOdds, @pointCount, @trajectory
  )
  ON CONFLICT(raceId, day, program) DO UPDATE SET
    capturedAt   = excluded.capturedAt,
    truePWin     = excluded.truePWin,
    openOdds     = excluded.openOdds,
    closeOdds    = excluded.closeOdds,
    pointCount   = excluded.pointCount,
    trajectory   = excluded.trajectory,
    modelQuality = excluded.modelQuality,
    fieldSize    = excluded.fieldSize
`);

const upsertRace = db.transaction((rows: Record<string, unknown>[]) => {
  for (const r of rows) stmtUpsert.run(r);
});

export function persistOddsTrajectory(race: Race): void {
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
  const rows: Record<string, unknown>[] = [];
  for (const rn of race.runners) {
    const hist = rn.oddsHistory;
    if (!hist || hist.length === 0) continue; // nothing to record yet
    rows.push({
      raceId: race.id,
      day,
      program: rn.program,
      trackCode: race.trackCode,
      raceNumber: race.raceNumber,
      trackType: race.trackType ?? null,
      modelQuality: race.modelQuality ?? null,
      fieldSize,
      postTime: race.postTime,
      capturedAt: now,
      truePWin: rn.truePWin ?? null,
      openOdds: hist[0].odds,
      closeOdds: hist[hist.length - 1].odds,
      pointCount: hist.length,
      // Absolute {t, odds} points. postTime is stored alongside, so analysis
      // reconstructs secondsToPost = (postTime - t)/1000 per point (→ T-5m,
      // T-2m, T-1m, T-30s buckets) without us committing to a fixed cadence.
      trajectory: JSON.stringify(hist),
    });
  }
  if (!rows.length) return;
  try { upsertRace(rows); } catch { /* trajectory loss is acceptable; never break the tick */ }
}

const stmtStamp = db.prepare(`
  UPDATE odds_trajectory SET
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

// Session-level guard so the grader doesn't re-run no-op UPDATEs for races that
// stay in the results feed for hours after settling.
const stamped = new Set<string>();

export function stampTrajectoryResults(
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
  const minCapturedAt = now - 24 * 3_600_000; // raceIds recycle across days
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
// card). Stamped rows are kept forever — they're the backtest set.
let lastPurge = 0;
export function purgeUnstampedTrajectories(): void {
  const now = Date.now();
  if (now - lastPurge < 3_600_000) return;
  lastPurge = now;
  try {
    db.prepare("DELETE FROM odds_trajectory WHERE settledAt IS NULL AND capturedAt < ?")
      .run(now - STALE_UNSTAMPED_MS);
  } catch { /* non-critical */ }
}
