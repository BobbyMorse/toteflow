import { NextResponse } from "next/server";
import { Tickets } from "@/lib/storage";
import type { Ticket } from "@/lib/types";

export const dynamic = "force-dynamic";

// Returns every ticket that was placed on the given local calendar day, in
// chronological order. `date` is a YYYY-MM-DD string interpreted in the
// VIEWER's timezone (?tz=, minutes, as Date.getTimezoneOffset returns) so it
// matches the calendar cell the user clicked — the calendar buckets days by
// the same offset. Falls back to server-local when tz is absent.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  const tzParam = url.searchParams.get("tz");
  const tzOffsetMin = tzParam != null && Number.isFinite(Number(tzParam)) ? Number(tzParam) : null;
  const [y, m, d] = date.split("-").map(Number);
  const start = tzOffsetMin != null
    ? Date.UTC(y, m - 1, d) + tzOffsetMin * 60_000
    : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = tzOffsetMin != null
    ? start + 86_400_000
    : new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();

  const tickets: Ticket[] = Tickets.list()
    .filter(t => t.strategyId != null && t.placedAt >= start && t.placedAt < end)
    .filter(t => t.status === "open" || t.status === "won" || t.status === "lost")
    .sort((a, b) => a.placedAt - b.placedAt);

  return NextResponse.json({ date, tickets });
}
