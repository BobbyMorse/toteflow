import { NextResponse } from "next/server";
import { liveProviders } from "@/lib/adapters";
import { autobook } from "@/lib/autobook";
import { grader } from "@/lib/grader";

export const dynamic = "force-dynamic";

export async function GET() {
  void autobook.tickIfDue();
  void grader.tickIfDue();

  const liveResults = await Promise.all(liveProviders().map(p => p.listRaces()));
  const all = liveResults.flat();
  all.sort((a, b) => a.postTime - b.postTime);
  const sources = [...new Set(all.map(r => r.source))];

  return NextResponse.json({
    races: all,
    sources,
    ts: Date.now(),
  });
}
