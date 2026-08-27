import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// CSV export of the SETTLED odds_trajectory rows — the steam-band backtest set.
// One row per (raceId, day, program) that has a stamped result. The full
// pre-off {t,odds} path is collapsed here into odds sampled at fixed
// seconds-to-post offsets so the payload stays small and analysis can define
// any crush window (open→T-60, T-120→close, etc.) without re-parsing blobs.
// Payoffs are per-$1 (already normalized on stamp). Field-wide, so analysis can
// regroup by (raceId, day) to replicate a strategy's per-race pick.
//   /api/debug/export-trajectory

const OFFSETS = [300, 180, 120, 90, 60, 45, 30, 20, 10, 0] as const;

// Odds at ~`targetSec` before post: the trajectory point whose seconds-to-post
// is nearest the target. Returns null if the path is empty.
function oddsAtOffset(
  traj: Array<{ t: number; odds: number }>,
  postTime: number,
  targetSec: number,
): number | null {
  let best: number | null = null;
  let bestDelta = Infinity;
  for (const p of traj) {
    const stp = (postTime - p.t) / 1000;
    const d = Math.abs(stp - targetSec);
    if (d < bestDelta) { bestDelta = d; best = p.odds; }
  }
  return best;
}

export async function GET() {
  const rows = db.prepare(`
    SELECT raceId, day, program, trackCode, trackType, modelQuality, fieldSize,
           postTime, truePWin, openOdds, closeOdds, pointCount, trajectory,
           finishPosition, winPayoff, placePayoff, showPayoff
    FROM odds_trajectory
    WHERE settledAt IS NOT NULL
    ORDER BY day, raceId, CAST(program AS INTEGER)
  `).all() as any[];

  const header = [
    "raceId", "day", "program", "trackCode", "trackType", "modelQuality", "fieldSize",
    "postTime", "truePWin", "openOdds", "closeOdds", "pointCount",
    ...OFFSETS.map(o => `o${o}`),
    "finishPosition", "winPayoff", "placePayoff", "showPayoff",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    let traj: Array<{ t: number; odds: number }> = [];
    try { traj = JSON.parse(r.trajectory); } catch { /* skip malformed */ }
    const offs = OFFSETS.map(o =>
      r.postTime ? (oddsAtOffset(traj, r.postTime, o)?.toFixed(2) ?? "") : "",
    );
    lines.push([
      r.raceId,
      r.day,
      r.program,
      r.trackCode ?? "",
      r.trackType ?? "",
      r.modelQuality ?? "",
      r.fieldSize ?? "",
      r.postTime ?? "",
      r.truePWin?.toFixed(4) ?? "",
      r.openOdds?.toFixed(2) ?? "",
      r.closeOdds?.toFixed(2) ?? "",
      r.pointCount ?? "",
      ...offs,
      r.finishPosition ?? "",
      r.winPayoff?.toFixed(2) ?? "",
      r.placePayoff?.toFixed(2) ?? "",
      r.showPayoff?.toFixed(2) ?? "",
    ].join(","));
  }
  const csv = lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="toteflow-trajectory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
