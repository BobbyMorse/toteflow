import { NextResponse } from "next/server";
import { Tickets } from "@/lib/storage";

export const dynamic = "force-dynamic";

// CSV export of every ticket. Open in Excel/Sheets for analysis without
// touching the SQLite file directly.
export async function GET() {
  const rows = Tickets.list();
  const header = [
    "id","placedAt","strategyId","raceId","trackCode","trackName","raceNumber",
    "horseName","type","selection","stake","capturedOdds","capturedEV",
    "potentialPayout","postTime","status","mode","settledAt","realizedPL",
    "closingOdds","clvPct","winners","reason",
  ];
  const lines = [header.join(",")];
  for (const t of rows) {
    const sel = t.selections.join("|");
    // CLV only meaningful for single-race WIN bets (closing snapshot is WIN-only).
    const clv = (t.type === "WIN" && t.capturedOdds && t.closingOdds)
      ? ((t.capturedOdds - t.closingOdds) / t.closingOdds * 100).toFixed(2)
      : "";
    const winners = (t.winners ?? []).join("|");
    const reason = (t.reason ?? "").replace(/[",\n\r]/g, " ").trim();
    lines.push([
      t.id,
      new Date(t.placedAt).toISOString(),
      t.strategyId ?? "",
      t.raceId,
      t.trackCode ?? "",
      `"${(t.trackName ?? "").replace(/"/g, '""')}"`,
      t.raceNumber ?? "",
      `"${(t.horseName ?? "").replace(/"/g, '""')}"`,
      t.type,
      sel,
      t.stake.toFixed(2),
      t.capturedOdds.toFixed(2),
      t.capturedEV.toFixed(2),
      t.potentialPayout.toFixed(2),
      t.postTime ? new Date(t.postTime).toISOString() : "",
      t.status,
      t.mode,
      t.settledAt ? new Date(t.settledAt).toISOString() : "",
      t.realizedPL?.toFixed(2) ?? "",
      t.closingOdds?.toFixed(2) ?? "",
      clv,
      winners,
      `"${reason}"`,
    ].join(","));
  }
  const csv = lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="toteflow-tickets-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}
