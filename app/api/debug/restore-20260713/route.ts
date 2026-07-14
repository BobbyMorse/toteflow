import { NextResponse } from "next/server";
import { Tickets } from "@/lib/storage";
import { db } from "@/lib/db";
import type { Ticket } from "@/lib/types";

export const dynamic = "force-dynamic";

// ONE-SHOT RESTORE — delete this route after it has run.
//
// Post-mortem correction (2026-07-14): the writes weren't lost WAL. Since the
// c4acf60 deploy (23:50Z), Tickets.update() threw RangeError on a missing
// @payoutSource bind — every promote/abort/settle mutated in-memory state and
// then died before the DB write. Restarts (deploys) reverted everything to
// the last persisted state. Fixed in 86ab0e9; this route replays the known
// outcomes.
//
// Batch 1 (23:52Z–01:12Z): reconstructed from tickets-page UI screenshots
// taken 2026-07-14 01:08Z. settledAt values are approximate (placedAt +
// 6 min). Two tickets that were still OPEN in the record have unknown
// outcomes and are restored as void — we will not guess results.
//
// Batch 2 (01:25Z–08:28Z): the overnight process memory-settled 8 more
// tickets before the 11:17Z deploy wiped it. Recovered verbatim from the
// in-memory CSV export (prod_tickets.csv, exported ~11:00Z) — grader-computed
// values, not guesses.
//
// Idempotent: rows are only touched while their status is a pre-restore state
// (staged / aborted / open / void) — never over an already-restored won/lost.

const RESTORE_NOTE = "restored 2026-07-14 from UI record after deploy WAL data loss";

interface Restore {
  id: string;
  patch: Partial<Ticket>;
}

const T = (iso: string) => Date.parse(iso);

const RESTORES: Restore[] = [
  { id: "auto_tvg-baseline-harness_1783986480908_vc3u", patch: {   // Beach Buggy OCD R5 WIN #1
    status: "won", stake: 20, capturedOdds: 15.0, closingOdds: 13.0,
    capturedEV: 31.4, closingEV: 13.9, potentialPayout: 300,
    realizedPL: 250.00, payoutSource: "tote", winners: ["1"],
    placedAt: T("2026-07-13T23:53:01Z"), settledAt: T("2026-07-13T23:59:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_tvg-baseline-harness_1783987435367_kf2o", patch: {   // Courtneys Promise WBS R5 WIN #8
    status: "won", stake: 20, capturedOdds: 15.0, closingOdds: 13.0,
    capturedEV: 5.7, closingEV: -8.4, potentialPayout: 300,
    realizedPL: 256.00, payoutSource: "tote", winners: ["8"],
    placedAt: T("2026-07-14T00:05:00Z"), settledAt: T("2026-07-14T00:11:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_track-bias-harness_1783987684700_duh8", patch: {     // Yall Keep Dreaming OCD R6 WIN #4 (lost)
    status: "lost", stake: 20, capturedOdds: 3.5, closingOdds: 4.0,
    capturedEV: 6.7, closingEV: 22.0, potentialPayout: 70,
    realizedPL: -20.00,
    placedAt: T("2026-07-14T00:13:00Z"), settledAt: T("2026-07-14T00:19:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_tvg-baseline-harness_1783987684695_yycq", patch: {   // Yall Keep Dreaming OCD R6 WIN #4 (shadow)
    status: "won", stake: 0, capturedOdds: 3.5, closingOdds: 4.0,
    capturedEV: 6.7, closingEV: 22.0, potentialPayout: 0,
    realizedPL: 0, shadow: true,
    placedAt: T("2026-07-14T00:13:02Z"), settledAt: T("2026-07-14T00:19:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_tvg-baseline_1783988641479_w9ta", patch: {           // Golden Luna PRM R9 WIN #1 (lost)
    status: "lost", stake: 20, capturedOdds: 4.5, closingOdds: 3.0,
    capturedEV: 11.4, closingEV: -25.8, potentialPayout: 90,
    realizedPL: -20.00,
    placedAt: T("2026-07-14T00:29:59Z"), settledAt: T("2026-07-14T00:36:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_tvg-baseline-harness_1783988936698_r5k1", patch: {   // Full Send OCD R7 WIN #2
    status: "won", stake: 20, capturedOdds: 5.5, closingOdds: 3.0,
    capturedEV: 6.7, closingEV: -41.8, potentialPayout: 110,
    realizedPL: 46.00, payoutSource: "tote", winners: ["2"],
    placedAt: T("2026-07-14T00:32:02Z"), settledAt: T("2026-07-14T00:38:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_fav-fade-harness_1783989620769_6vgf", patch: {       // Whywoodidothat NFL R8 WIN #1
    status: "won", stake: 20, capturedOdds: 9.0, closingOdds: 13.0,
    capturedEV: 5.7, closingEV: 52.6, potentialPayout: 180,
    realizedPL: 258.00, payoutSource: "tote", winners: ["1"],
    placedAt: T("2026-07-14T00:43:00Z"), settledAt: T("2026-07-14T00:49:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_tvg-baseline-harness_1783989902273_ru8n", patch: {   // Wash The Dragon OCD R8 WIN #1
    status: "won", stake: 20, capturedOdds: 4.0, closingOdds: 2.2,
    capturedEV: 10.8, closingEV: -39.1, potentialPayout: 80,
    realizedPL: 24.00, payoutSource: "tote", winners: ["1"],
    placedAt: T("2026-07-14T00:50:02Z"), settledAt: T("2026-07-14T00:56:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_trifecta-key_1783990482729_xavi", patch: {           // King George PRM R10 TRIFECTA 2-4-8 (lost)
    status: "lost", stake: 3, capturedOdds: 2.8, closingOdds: 5.0,
    capturedEV: 105.0,
    realizedPL: -3.00,
    placedAt: T("2026-07-14T00:55:03Z"), settledAt: T("2026-07-14T01:05:00Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  // Still OPEN when the record was taken — outcomes unknown, so void.
  { id: "auto_tvg-baseline_1783990801576_on6n", patch: {           // Holy Kingdom MNR R6 WIN #7
    status: "void", stake: 20, capturedOdds: 7.0, capturedEV: 17.7,
    realizedPL: 0,
    placedAt: T("2026-07-14T01:05:00Z"), settledAt: T("2026-07-14T09:00:00Z"),
    abortReason: `result unknown — settlement lost in deploy data loss; voided (${RESTORE_NOTE})`,
  }},
  { id: "auto_tvg-baseline-harness_1783991245111_eodd", patch: {   // Suburban Lady OCD R9 WIN #8
    status: "void", stake: 20, capturedOdds: 25.0, capturedEV: 5.1,
    realizedPL: 0,
    placedAt: T("2026-07-14T01:08:01Z"), settledAt: T("2026-07-14T09:00:00Z"),
    abortReason: `result unknown — settlement lost in deploy data loss; voided (${RESTORE_NOTE})`,
  }},

  // ---- Batch 2: memory-settled overnight, recovered from prod_tickets.csv ----
  { id: "auto_tvg-baseline-harness_1783985580204_87js", patch: {   // Beach Keepers WBS R4 WIN #7 (DB-open "1 fired")
    status: "lost", stake: 20, capturedOdds: 10.0,
    capturedEV: 6.48, potentialPayout: 200,
    realizedPL: -20.00, winners: ["6", "3", "2", "8"],
    placedAt: T("2026-07-13T23:38:00.786Z"), settledAt: T("2026-07-14T01:26:11.543Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_tvg-baseline-harness_1783986317393_1ud5", patch: {   // Ionian Hanover NFL R6 WIN #5
    status: "lost", stake: 20, capturedOdds: 6.0,
    capturedEV: 34.08, potentialPayout: 120,
    realizedPL: -20.00, winners: ["3", "4", "2", "1"],
    placedAt: T("2026-07-13T23:50:01.970Z"), settledAt: T("2026-07-14T01:25:41.969Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_dd-consensus_1783992383812_zgq1", patch: {           // DD L05 R1-R2 8/7 — WON, real tote payout
    status: "won", stake: 1, capturedOdds: 0,
    capturedEV: 112.95, potentialPayout: 14.79,
    realizedPL: 3.90, payoutSource: "tote", winners: ["8", "7"],
    placedAt: T("2026-07-14T01:26:23.812Z"), settledAt: T("2026-07-14T02:58:14.591Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_track-bias-harness_1783992438783_0i8i", patch: {     // Chow For Now WBS R8 WIN #8
    status: "lost", stake: 20, capturedOdds: 20.0, closingOdds: 26.0,
    capturedEV: 6.33, potentialPayout: 400,
    realizedPL: -20.00, winners: ["5", "1", "2", "7"],
    placedAt: T("2026-07-14T01:29:01.071Z"), settledAt: T("2026-07-14T01:44:11.911Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_tvg-baseline-harness_1783993464164_0aui", patch: {   // Mayhem Like Me OCD R11 WIN #1
    status: "lost", stake: 20, capturedOdds: 34.0, closingOdds: 3.0,
    capturedEV: 81.23, potentialPayout: 680,
    realizedPL: -20.00, winners: ["4", "1", "7", "2"],
    placedAt: T("2026-07-14T01:46:00.578Z"), settledAt: T("2026-07-14T02:00:42.310Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_track-bias-harness_1783995690175_4dzc", patch: {     // Tactical Strike WBS R10 WIN #9
    status: "lost", stake: 20, capturedOdds: 12.0, closingOdds: 28.0,
    capturedEV: 8.97, potentialPayout: 240,
    realizedPL: -20.00, winners: ["4", "2", "3", "5"],
    placedAt: T("2026-07-14T02:25:58.411Z"), settledAt: T("2026-07-14T02:40:43.627Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_track-bias-harness_1784000032265_xows", patch: {     // Vel Mr Steve NFL R16 WIN #4
    status: "lost", stake: 20, capturedOdds: 23.0, closingOdds: 12.0,
    capturedEV: 14.14, potentialPayout: 460,
    realizedPL: -20.00, winners: ["1", "9", "3", "4"],
    placedAt: T("2026-07-14T03:35:02.713Z"), settledAt: T("2026-07-14T03:51:46.455Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
  { id: "auto_trifecta-key_1784016460551_cxrc", patch: {           // Trifecta box 11/9/2 JP4 R8 (the "mobile trifecta")
    status: "lost", stake: 3, capturedOdds: 2.2, closingOdds: 1.6,
    capturedEV: 11.87, potentialPayout: 45.13,
    realizedPL: -3.00, winners: ["8", "11", "10", "5"],
    placedAt: T("2026-07-14T08:10:01.787Z"), settledAt: T("2026-07-14T08:27:55.701Z"),
    abortedAt: undefined, abortReason: undefined,
  }},
];

const stmtAppendReason = db.prepare("UPDATE tickets SET reason = ? WHERE id = ?");

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== "restore0713") {
    return NextResponse.json({ error: "bad key" }, { status: 403 });
  }
  const results: Array<{ id: string; outcome: string }> = [];
  for (const { id, patch } of RESTORES) {
    const t = Tickets.byId(id);
    if (!t) { results.push({ id, outcome: "NOT FOUND" }); continue; }
    // Accept any pre-restore state. Rows can be staged (persisted stage,
    // updates threw ever after), aborted (pre-bug aborts), open (promote
    // persisted pre-bug, settle lost — e.g. Beach Keepers, the DD), or void
    // (janitor swept a stale open before this ran). The guard only refuses
    // to overwrite a row that already carries a restored final outcome.
    if (t.status === "won" || t.status === "lost") { results.push({ id, outcome: `skipped (status=${t.status})` }); continue; }
    Tickets.update(id, patch);
    // reason isn't covered by the shared UPDATE statement — persist directly.
    const newReason = `${t.reason ?? ""} · ${RESTORE_NOTE}`.trim();
    stmtAppendReason.run(newReason, id);
    Tickets.update(id, { reason: newReason });   // keep in-memory copy in sync
    results.push({ id, outcome: `restored → ${patch.status}` });
  }
  return NextResponse.json({ results });
}
