import { NextResponse } from "next/server";
import { strategyAnalytics, dailyPL, dailyTotals, trackPerformance, totals, consensusTiers, pairConsensus } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lookback = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 14));
  return NextResponse.json({
    totals: totals(),
    strategies: strategyAnalytics(),
    dailyPL: dailyPL(lookback),
    dailyTotals: dailyTotals(lookback),
    tracks: trackPerformance(),
    consensusTiers: consensusTiers(),
    pairConsensus: pairConsensus(),
    lookbackDays: lookback,
  });
}
