import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Recording-health check: proves the two persistence paths are alive without
// SSH access to the volume. Per-day runner_snapshots counts (captured vs
// result-stamped) and ticket write recency. If snapshots.lastCapturedAt is
// stale while races are running, the training-set recorder is broken.
export async function GET() {
  const snapDays = db.prepare(`
    SELECT day,
           COUNT(*)                                    AS rows,
           COUNT(DISTINCT raceId)                      AS races,
           SUM(CASE WHEN settledAt IS NOT NULL THEN 1 ELSE 0 END) AS stamped
    FROM runner_snapshots
    GROUP BY day ORDER BY day DESC LIMIT 10
  `).all();
  const snapLast = db.prepare(`
    SELECT MAX(capturedAt) AS lastCapturedAt, MAX(settledAt) AS lastStampedAt,
           COUNT(*) AS totalRows
    FROM runner_snapshots
  `).get() as { lastCapturedAt: number | null; lastStampedAt: number | null; totalRows: number };
  const ticketLast = db.prepare(`
    SELECT MAX(placedAt) AS lastPlacedAt, MAX(settledAt) AS lastSettledAt,
           COUNT(*) AS totalRows
    FROM tickets
  `).get() as { lastPlacedAt: number | null; lastSettledAt: number | null; totalRows: number };
  const iso = (t: number | null) => (t ? new Date(t).toISOString() : null);
  return NextResponse.json({
    now: new Date().toISOString(),
    snapshots: {
      totalRows: snapLast.totalRows,
      lastCapturedAt: iso(snapLast.lastCapturedAt),
      lastStampedAt: iso(snapLast.lastStampedAt),
      byDay: snapDays,
    },
    tickets: {
      totalRows: ticketLast.totalRows,
      lastPlacedAt: iso(ticketLast.lastPlacedAt),
      lastSettledAt: iso(ticketLast.lastSettledAt),
    },
  });
}
