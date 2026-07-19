import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadRacesFromDb, analyze, formatReport } from "@/lib/closing-line-backtest";

export const dynamic = "force-dynamic";

// Field-wide closing-line backtest against the production DB. The one
// experiment that gates a model-driven CAW: does blending truePWin into the
// closing market beat the market out-of-sample, and does any rule clear takeout
// on real payoffs? Text by default; ?format=json for the raw report.
//   /api/debug/closing-line-backtest
//   /api/debug/closing-line-backtest?train=0.7&minField=5&format=json
export async function GET(req: Request) {
  const url = new URL(req.url);
  const trainFrac = Number(url.searchParams.get("train") ?? "0.7");
  const minField = Number(url.searchParams.get("minField") ?? "5");
  const bootstrap = Number(url.searchParams.get("bootstrap") ?? "2000");

  const races = loadRacesFromDb(db, minField);
  if (races.length === 0) {
    return NextResponse.json({ error: "no settled field-wide snapshots" }, { status: 404 });
  }
  const report = analyze(races, { trainFrac, minField, bootstrap });

  if (url.searchParams.get("format") === "json") {
    return NextResponse.json(report);
  }
  return new NextResponse(formatReport(report) + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
