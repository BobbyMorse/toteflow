import { NextResponse } from "next/server";
import { Tickets } from "@/lib/storage";
import type { Ticket } from "@/lib/types";

export const dynamic = "force-dynamic";

// Returns every ticket that was placed on the given local calendar day, in
// chronological order. `date` is a YYYY-MM-DD string, interpreted as local
// time so it matches the calendar cell the user clicked.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end   = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();

  const tickets: Ticket[] = Tickets.list()
    .filter(t => t.strategyId != null && t.placedAt >= start && t.placedAt < end)
    .filter(t => t.status === "open" || t.status === "won" || t.status === "lost")
    .sort((a, b) => a.placedAt - b.placedAt);

  return NextResponse.json({ date, tickets });
}
