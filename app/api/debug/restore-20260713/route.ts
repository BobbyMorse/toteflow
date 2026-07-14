import { NextResponse } from "next/server";
import { Tickets } from "@/lib/storage";
import { db } from "@/lib/db";
import type { Ticket } from "@/lib/types";

export const dynamic = "force-dynamic";

// ONE-SHOT RESTORE — delete this route after it has run.
//
// The 2026-07-13 deploy killed the machine before SQLite WAL writes reached
// disk (synchronous=NORMAL): every promote + settlement from ~23:52Z to
// ~01:12Z was lost, reverting settled tickets to their staged state, which
// the next boot then aborted as "missed". The settled outcomes below were
// reconstructed from the tickets-page UI (screenshots taken 2026-07-14
// 01:08Z, before the losing deploy). settledAt values are approximate
// (placedAt + 6 min). Two tickets that were still OPEN in the record have
// unknown outcomes and are restored as void — we will not guess results.
//
// Idempotent: each row is only touched while its status is still "aborted".

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
    if (t.status !== "aborted") { results.push({ id, outcome: `skipped (status=${t.status})` }); continue; }
    Tickets.update(id, patch);
    // reason isn't covered by the shared UPDATE statement — persist directly.
    const newReason = `${t.reason ?? ""} · ${RESTORE_NOTE}`.trim();
    stmtAppendReason.run(newReason, id);
    Tickets.update(id, { reason: newReason });   // keep in-memory copy in sync
    results.push({ id, outcome: `restored → ${patch.status}` });
  }
  return NextResponse.json({ results });
}
