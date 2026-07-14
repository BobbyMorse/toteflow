import { NextResponse } from "next/server";
import { autobook } from "@/lib/autobook";
import { grader } from "@/lib/grader";
import { AutoBook, Tickets, deriveClosingEV } from "@/lib/storage";
import { strategies } from "@/lib/strategies";
import type { Ticket } from "@/lib/types";

export const dynamic = "force-dynamic";

interface StrategyStats {
  id: string;
  name: string;
  thesis: string;
  config: ReturnType<typeof AutoBook.strategyConfig>;
  total: number;            // actual bets (open + settled) — excludes staged/aborted
  open: number;
  staged: number;           // matched but waiting on optimal-timer
  aborted: number;          // killed because live EV collapsed
  settled: number;
  won: number;
  lost: number;
  hitRate: number | null;
  realizedPL: number;
  totalStaked: number;
  roi: number | null;
  capturedEV: number;
  avgClv: number | null;
  avgClosingEV: number | null;   // mean model EV at race-off across settled bets
                                 // — the truthful grading metric (captured EV
                                 // is frozen at fire and goes stale on odds drift)
}

function statsFor(strategyId: string, allTickets: Ticket[]): StrategyStats {
  const tickets = allTickets.filter(t => t.strategyId === strategyId);
  // Actual bets = anything that promoted past staging. Staged and aborted
  // tickets are decisions in flight or decisions not to bet — they shouldn't
  // count as placed bets.
  const bets = tickets.filter(t => t.status === "open" || t.status === "won" || t.status === "lost");
  const settled = tickets.filter(t => t.status === "won" || t.status === "lost");
  const won = settled.filter(t => t.status === "won");
  const open = tickets.filter(t => t.status === "open");
  const staged = tickets.filter(t => t.status === "staged");
  const aborted = tickets.filter(t => t.status === "aborted");
  const totalStaked = bets.reduce((a, t) => a + t.stake, 0);
  const realizedPL = settled.reduce((a, t) => a + (t.realizedPL ?? 0), 0);
  const capturedEV = bets.reduce((a, t) => a + (t.capturedEV * t.stake) / 100, 0);
  // CLV only meaningful for single-race WIN bets — closing snapshot captures
  // WIN odds, so comparing against PLACE/SHOW captured odds or Pick-N tickets
  // produces apples-to-oranges numbers (notably misleading on Dr Z place bets).
  const clvSamples = settled.filter(t => t.type === "WIN" && t.closingOdds && t.capturedOdds);
  const avgClv = clvSamples.length
    ? clvSamples.reduce((a, t) =>
        a + ((t.capturedOdds - (t.closingOdds ?? t.capturedOdds)) / (t.closingOdds ?? t.capturedOdds)), 0,
      ) / clvSamples.length * 100
    : null;
  // Prefer derive-from-odds over stored closingEV: old rows may carry the
  // race-off snapshot's EV, which evaluates at closing PRICE and collapses to
  // ~-takeout for bombs. Same fallback the tickets page uses per-row.
  const closingEvValues = settled
    .map(t => deriveClosingEV(t) ?? t.closingEV ?? null)
    .filter((v): v is number => v != null);
  const avgClosingEV = closingEvValues.length
    ? closingEvValues.reduce((a, v) => a + v, 0) / closingEvValues.length
    : null;
  const strat = strategies.find(s => s.id === strategyId)!;
  return {
    id: strategyId,
    name: strat.name,
    thesis: strat.thesis,
    config: AutoBook.strategyConfig(strategyId),
    total: bets.length,
    open: open.length,
    staged: staged.length,
    aborted: aborted.length,
    settled: settled.length,
    won: won.length,
    lost: settled.length - won.length,
    hitRate: settled.length ? won.length / settled.length : null,
    realizedPL,
    totalStaked,
    roi: totalStaked ? realizedPL / totalStaked : null,
    capturedEV,
    avgClv,
    avgClosingEV,
  };
}

export async function GET(req: Request) {
  void autobook.tickIfDue();
  void grader.tickIfDue();

  const all = Tickets.list().filter(t => t.mode === "auto");
  const perStrategy = strategies.map(s => statsFor(s.id, all));

  // Roll-ups across all auto tickets. Two distinctions matter for honest totals:
  //   1. Filter out shadow tickets (stake=0, payout=0) — they're attribution
  //      records for "another strategy already covered this bet", not actual
  //      placed bets. Including them inflates Bets/Won/Lost counts.
  //   2. "Bets fired" should be tickets that became real bets — open + settled.
  //      Staged and aborted are decisions in flight / decisions not to bet.
  const realAll = all.filter(t => !t.shadow);
  const bets = realAll.filter(t => t.status === "open" || t.status === "won" || t.status === "lost");
  const settled = realAll.filter(t => t.status === "won" || t.status === "lost");
  const won = settled.filter(t => t.status === "won");
  const realizedPL = settled.reduce((a, t) => a + (t.realizedPL ?? 0), 0);
  const totalStaked = bets.reduce((a, t) => a + t.stake, 0);
  const settledStaked = settled.reduce((a, t) => a + t.stake, 0);
  const roi = settledStaked > 0 ? realizedPL / settledStaked : null;
  // Predicted edge in dollars — the model's expected-value claim summed across
  // all bets. NOT realized money; clearly labeled as such on the UI.
  const predictedEdge = bets.reduce((a, t) => a + (t.capturedEV * t.stake) / 100, 0);
  const totalsClosingValues = settled
    .map(t => deriveClosingEV(t) ?? t.closingEV ?? null)
    .filter((v): v is number => v != null);
  const avgClosingEV = totalsClosingValues.length
    ? totalsClosingValues.reduce((a, v) => a + v, 0) / totalsClosingValues.length
    : null;

  // Today's slice (calendar day, settled, non-shadow). The user needs this to
  // distinguish "today is bad" from a lifetime average that hides recent perf.
  // "Today" = since midnight in the BROWSER's timezone — the server runs on Fly
  // in UTC, so the client sends its UTC offset (?tz=, minutes, as returned by
  // Date.getTimezoneOffset). Without it, fall back to server-local midnight.
  const tzParam = new URL(req.url).searchParams.get("tz");
  const tzOffsetMin = tzParam != null && Number.isFinite(Number(tzParam)) ? Number(tzParam) : null;
  let cutoff: number;
  if (tzOffsetMin != null) {
    const DAY = 24 * 60 * 60 * 1000;
    const localNow = Date.now() - tzOffsetMin * 60 * 1000;
    cutoff = Math.floor(localNow / DAY) * DAY + tzOffsetMin * 60 * 1000;
  } else {
    cutoff = new Date().setHours(0, 0, 0, 0);
  }
  const todaySettled = settled.filter(t => t.placedAt >= cutoff);
  const todayWon = todaySettled.filter(t => t.status === "won");
  const todayPL = todaySettled.reduce((a, t) => a + (t.realizedPL ?? 0), 0);
  const todayStaked = todaySettled.reduce((a, t) => a + t.stake, 0);
  const todayROI = todayStaked > 0 ? todayPL / todayStaked : null;
  const todayHitRate = todaySettled.length ? todayWon.length / todaySettled.length : null;

  return NextResponse.json({
    globalEnabled: AutoBook.globalEnabled(),
    strategies: perStrategy,
    totals: {
      total: bets.length,
      open: realAll.filter(t => t.status === "open").length,
      staged: realAll.filter(t => t.status === "staged").length,
      aborted: realAll.filter(t => t.status === "aborted").length,
      settled: settled.length,
      won: won.length,
      lost: settled.length - won.length,
      hitRate: settled.length ? won.length / settled.length : null,
      realizedPL,
      totalStaked,
      roi,
      // Renamed from capturedEV to make it unambiguous on the UI — this is
      // the model's predicted edge in $, not realized profit.
      predictedEdge,
      avgClosingEV,
    },
    today: {
      settled: todaySettled.length,
      won: todayWon.length,
      lost: todaySettled.length - todayWon.length,
      hitRate: todayHitRate,
      realizedPL: todayPL,
      totalStaked: todayStaked,
      roi: todayROI,
    },
    bookerLog: autobook.recentLog(30),
    graderLog: grader.recentLog(30),
    carryoverAlerts: autobook.recentCarryovers(20),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.globalEnabled === "boolean") {
    AutoBook.setGlobalEnabled(body.globalEnabled);
  }
  if (body.strategy && body.strategy.id) {
    const patch: any = {};
    if (typeof body.strategy.enabled === "boolean") patch.enabled = body.strategy.enabled;
    if (typeof body.strategy.evThreshold === "number") patch.evThreshold = body.strategy.evThreshold;
    if (typeof body.strategy.stake === "number") patch.stake = body.strategy.stake;
    if (typeof body.strategy.fireAtPhase === "string") patch.fireAtPhase = body.strategy.fireAtPhase;
    AutoBook.setStrategyConfig(body.strategy.id, patch);
  }
  return NextResponse.json({
    globalEnabled: AutoBook.globalEnabled(),
    configs: AutoBook.allStrategyConfigs(),
  });
}
