import { NextResponse } from "next/server";
import { strategyAnalytics, dailyPL, dailyTotals, trackPerformance, totals, consensusTiers, pairConsensus } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lookback = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 14));
  // Viewer's UTC offset in minutes (Date.getTimezoneOffset) — day buckets
  // follow the browser's calendar so they agree with the "today" strip.
  const tzParam = url.searchParams.get("tz");
  const tz = tzParam != null && Number.isFinite(Number(tzParam)) ? Number(tzParam) : null;
  return NextResponse.json({
    totals: totals(),
    strategies: strategyAnalytics(),
    dailyPL: dailyPL(lookback, tz),
    dailyTotals: dailyTotals(lookback, tz),
    tracks: trackPerformance(),
    consensusTiers: consensusTiers(),
    pairConsensus: pairConsensus(),
    lookbackDays: lookback,
  });
}
