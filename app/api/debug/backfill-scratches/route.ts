import { NextResponse } from "next/server";
import { Tickets } from "@/lib/storage";
import type { Ticket } from "@/lib/types";

export const dynamic = "force-dynamic";

// Re-check every "lost" TVG ticket against the current TVG results feed and
// convert to "void" (realizedPL 0) any where a selected horse turned out to be
// scratched. Correction for the pre-v4-grader window where scratches were
// misgraded as losses.
//
// Scope: only races still visible in TVG's live feed (typically same-day and
// some overnight). Older days can't be re-checked here — no historical feed.
//
// Usage:
//   GET /api/debug/backfill-scratches            → dry-run report
//   GET /api/debug/backfill-scratches?apply=1    → apply the fixes

const ENDPOINT = "https://service.tvg.com/graph/v2/query";
const RESULTS_QUERY = `{
  races {
    id number trackCode
    status { code name }
    results {
      runners { biNumber finishPosition finishStatus }
    }
  }
}`;

interface TvgRunner {
  biNumber: number;
  finishPosition: number | null;
  finishStatus: string | null;
}
interface TvgRace {
  id: string;
  number: string;
  trackCode: string;
  status: { code: string; name: string } | null;
  results: { runners: TvgRunner[] | null } | null;
}

function isScratched(rn: TvgRunner | undefined): boolean {
  if (!rn) return false;
  return !rn.finishStatus && rn.finishPosition == null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "1";

  let races: TvgRace[] = [];
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ToteFlow/0.1" },
      body: JSON.stringify({ query: RESULTS_QUERY }),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: `TVG HTTP ${res.status}` }, { status: 502 });
    const json: any = await res.json();
    races = json.data?.races ?? [];
  } catch (e) {
    return NextResponse.json({ error: `TVG fetch failed: ${(e as Error).message}` }, { status: 502 });
  }

  const byId = new Map(races.map(r => [`TVG-${r.id}`, r]));
  const byTrackRace = new Map<string, TvgRace>();
  for (const r of races) byTrackRace.set(`${r.trackCode}-${r.number}`, r);

  const lostTickets = Tickets.list().filter(t =>
    t.status === "lost" && t.raceId.startsWith("TVG-"),
  );

  interface Finding {
    id: string;
    raceId: string;
    trackCode?: string;
    raceNumber?: number;
    type: Ticket["type"];
    selections: string[];
    horseName?: string;
    stake: number;
    scratchedSelections: string[];
    reason: string;
    action: "void" | "not-in-feed" | "not-scratched";
  }

  const findings: Finding[] = [];
  const PICKN = new Set<Ticket["type"]>(["DD", "P3", "P4", "P5", "P6", "J6"]);

  for (const t of lostTickets) {
    const base: Omit<Finding, "scratchedSelections" | "reason" | "action"> = {
      id: t.id,
      raceId: t.raceId,
      trackCode: t.trackCode,
      raceNumber: t.raceNumber,
      type: t.type,
      selections: t.selections,
      horseName: t.horseName,
      stake: t.stake,
    };

    if (PICKN.has(t.type)) {
      if (!t.legs?.length || !t.trackCode) continue;
      const scratchedByLeg: { raceNumber: number; scratched: string[]; allScratched: boolean }[] = [];
      let anyLegMissing = false;
      for (const leg of t.legs) {
        const race = byTrackRace.get(`${t.trackCode}-${leg.raceNumber}`);
        if (!race || !["RO", "MO"].includes(race.status?.code ?? "")) {
          anyLegMissing = true; break;
        }
        const runners = race.results?.runners ?? [];
        const scratched = leg.selections.filter(sel =>
          isScratched(runners.find(rn => String(rn.biNumber) === String(sel))),
        );
        scratchedByLeg.push({
          raceNumber: leg.raceNumber,
          scratched,
          allScratched: scratched.length === leg.selections.length,
        });
      }
      if (anyLegMissing) {
        findings.push({ ...base, scratchedSelections: [], reason: "one or more legs not in TVG feed", action: "not-in-feed" });
        continue;
      }
      const legsFullyScratched = scratchedByLeg.filter(l => l.allScratched).map(l => l.raceNumber);
      if (legsFullyScratched.length > 0) {
        findings.push({
          ...base,
          scratchedSelections: scratchedByLeg.flatMap(l => l.scratched),
          reason: `all picks scratched on leg(s) R${legsFullyScratched.join(",R")}`,
          action: "void",
        });
      } else {
        findings.push({ ...base, scratchedSelections: [], reason: "no fully-scratched legs", action: "not-scratched" });
      }
      continue;
    }

    // Single-race: WIN/PLACE/SHOW/EXACTA/TRIFECTA
    const race = byId.get(t.raceId);
    if (!race || !["RO", "MO"].includes(race.status?.code ?? "")) {
      findings.push({ ...base, scratchedSelections: [], reason: "race not in TVG feed", action: "not-in-feed" });
      continue;
    }
    const runners = race.results?.runners ?? [];
    const scratched = t.selections.filter(sel =>
      isScratched(runners.find(rn => String(rn.biNumber) === String(sel))),
    );
    if (scratched.length > 0) {
      findings.push({
        ...base,
        scratchedSelections: scratched,
        reason: `scratched: #${scratched.join(",#")}`,
        action: "void",
      });
    } else {
      findings.push({ ...base, scratchedSelections: [], reason: "no scratched selections", action: "not-scratched" });
    }
  }

  const toVoid = findings.filter(f => f.action === "void");
  const notInFeed = findings.filter(f => f.action === "not-in-feed").length;
  const notScratched = findings.filter(f => f.action === "not-scratched").length;
  const recoveredStake = toVoid.reduce((s, f) => s + f.stake, 0);

  if (apply) {
    for (const f of toVoid) {
      Tickets.update(f.id, {
        status: "void",
        realizedPL: 0,
        settledAt: Date.now(),
        abortReason: `backfill: ${f.reason}`,
      });
    }
  }

  return NextResponse.json({
    mode: apply ? "APPLIED" : "DRY_RUN — pass ?apply=1 to write",
    scanned: lostTickets.length,
    counts: {
      voided: toVoid.length,
      notInFeed,
      notScratched,
    },
    recoveredStakeUSD: Number(recoveredStake.toFixed(2)),
    voidCandidates: toVoid,
  });
}
