"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Ticket } from "@/lib/types";
import { verificationLinks } from "@/lib/verification";
import { useToteflow } from "@/lib/store";
import { decideBetWindow, type BetWindowDecision } from "@/lib/optimal-timer";
import { apiUrl } from "@/lib/api-url";
import type { AutobookState } from "@/lib/autobook-view";
import { strategyCalibratedTrueP, evPercentFromTrueP } from "@/lib/strategy-calibration";
import { isMeasureOnly } from "@/lib/strategies/measure-only";
import Link from "next/link";
import clsx from "clsx";

function sourceFromRaceId(raceId: string): string {
  if (raceId.startsWith("TVG-")) return "tvg";
  return "unknown";
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [state, setState] = useState<AutobookState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [t, ab] = await Promise.all([
        fetch(apiUrl("/api/tickets")).then(r => r.json()),
        fetch(apiUrl(`/api/autobook?tz=${new Date().getTimezoneOffset()}`)).then(r => r.json()),
      ]);
      setTickets(t.tickets ?? []);
      setState(ab);
      setLoading(false);
    };
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  async function toggleGlobal() {
    if (!state) return;
    const res = await fetch(apiUrl("/api/autobook"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ globalEnabled: !state.globalEnabled }),
    });
    const j = await res.json();
    setState(s => s ? { ...s, globalEnabled: j.globalEnabled } : s);
  }

  return (
    <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-baseline gap-2 sm:gap-3">
        <h1 className="text-xl sm:text-2xl font-display font-semibold">Tickets</h1>
        <span className="stat-label">Live opportunities and settled history · CLV-tracked against TVG closing odds.</span>
      </header>

      {/* DATA-SOURCE PROVENANCE */}
      <section className="panel p-3 text-xs flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-accent-overlay font-mono">● LIVE</span>
        <span className="text-ink-1">Source:</span>
        <a href="https://service.tvg.com/graph/v2/query" target="_blank" rel="noreferrer"
           className="font-mono text-accent-cyan hover:underline break-all">service.tvg.com/graph/v2/query</a>
        <span className="text-ink-2 sm:ml-auto">View the actual upstream response:</span>
        <a href="/api/debug/raw-tvg" target="_blank" rel="noreferrer"
           className="font-mono text-accent-cyan hover:underline break-all">/api/debug/raw-tvg ↗</a>
      </section>

      {/* GLOBAL CONTROL + TOTALS */}
      {state && (
        <section className={clsx("panel p-3 sm:p-5", state.globalEnabled && "ring-1 ring-accent-cyan/30")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button onClick={toggleGlobal}
                className={clsx(
                  "px-3 py-1.5 rounded-md text-sm font-semibold border transition-colors",
                  state.globalEnabled
                    ? "bg-accent-overlay/20 border-accent-overlay/50 text-accent-overlay"
                    : "bg-bg-2 border-line text-ink-1",
                )}>
                {state.globalEnabled ? "Auto-book: ON" : "Auto-book: OFF"}
              </button>
              <span className="stat-label">
                {state.strategies.filter(s => s.config.enabled).length} of {state.strategies.length} strategies enabled
              </span>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
              <Stat label="Bets fired" value={state.totals.total.toString()}/>
              <Stat label="Staged" value={state.totals.staged.toString()}/>
              <Stat label="Aborted (saved)" value={state.totals.aborted.toString()}/>
              <Stat label="Open" value={state.totals.open.toString()}/>
              <Stat label="Hit rate" value={state.totals.hitRate == null ? "—" : `${(state.totals.hitRate*100).toFixed(0)}%`}/>
              <Stat label="Realized P/L"
                value={`${state.totals.realizedPL >= 0 ? "+" : ""}$${state.totals.realizedPL.toFixed(2)}`}
                color={state.totals.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam"}/>
              <Stat label="ROI (lifetime)"
                value={state.totals.roi == null ? "—"
                  : `${state.totals.roi >= 0 ? "+" : ""}${(state.totals.roi * 100).toFixed(1)}%`}
                color={state.totals.roi == null ? undefined
                  : state.totals.roi >= 0 ? "text-accent-overlay" : "text-accent-steam"}/>
              <Stat label="Predicted edge (model $)"
                value={`${state.totals.predictedEdge >= 0 ? "+" : ""}$${state.totals.predictedEdge.toFixed(2)}`}
                title="Sum of (capturedEV% × stake) across all bets. This is what the MODEL predicted, NOT realized profit. Compare to Realized P/L — gaps mean the model is miscalibrated."
                color="text-ink-2"/>
              <Stat label="Avg closing EV"
                value={state.totals.avgClosingEV == null ? "—"
                  : `${state.totals.avgClosingEV >= 0 ? "+" : ""}${state.totals.avgClosingEV.toFixed(1)}%`}
                color={state.totals.avgClosingEV == null ? undefined
                  : state.totals.avgClosingEV >= 0 ? "text-accent-overlay" : "text-accent-steam"}/>
            </div>
          </div>

          {/* TODAY-ONLY SLICE — surfaces today's actual perf separately from the
              lifetime average. Without this, a bad day hides inside a multi-week
              hit rate and the user can't see "we're losing right now".
              "Today" = calendar day since local midnight (tz offset passed to
              the API), matching the History section below. */}
          {state.today && state.today.settled > 0 && (
            <div className="mt-4 pt-3 border-t border-line/40 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-3 sm:gap-4">
              <span className="stat-label text-ink-2 col-span-2 sm:col-auto">Today (since midnight, settled):</span>
              <Stat label="Bets" value={state.today.settled.toString()}/>
              <Stat label="Won"
                value={`${state.today.won} / ${state.today.settled}`}
                color={state.today.won > 0 ? "text-accent-overlay" : "text-ink-2"}/>
              <Stat label="Hit rate"
                value={state.today.hitRate == null ? "—" : `${(state.today.hitRate * 100).toFixed(1)}%`}/>
              <Stat label="Staked"
                value={`$${state.today.totalStaked.toFixed(2)}`}/>
              <Stat label="P/L"
                value={`${state.today.realizedPL >= 0 ? "+" : ""}$${state.today.realizedPL.toFixed(2)}`}
                color={state.today.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam"}/>
              <Stat label="ROI"
                value={state.today.roi == null ? "—"
                  : `${state.today.roi >= 0 ? "+" : ""}${(state.today.roi * 100).toFixed(1)}%`}
                color={state.today.roi == null ? undefined
                  : state.today.roi >= 0 ? "text-accent-overlay" : "text-accent-steam"}/>
            </div>
          )}
        </section>
      )}

      {/* ENGINE LOGS */}
      {state && (
        <details className="panel p-4">
          <summary className="cursor-pointer text-xs text-ink-2 font-mono uppercase tracking-wider hover:text-ink-1">
            Engine logs ({state.bookerLog.length + state.graderLog.length})
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <LogPanel title="Auto-booker" entries={state.bookerLog}/>
            <LogPanel title="Results grader" entries={state.graderLog}/>
          </div>
        </details>
      )}

      {/* LIVE OPPORTUNITIES — staged (waiting on optimal-timer) + open (already fired).
          Grouped so multiple strategies agreeing on the same horse collapse into one card. */}
      {!loading && tickets.filter(t => t.status === "open" || t.status === "staged").length > 0 && (() => {
        const liveTickets = tickets.filter(t => t.status === "open" || t.status === "staged");
        const groups = groupOpenBets(liveTickets);
        const stagedCount = liveTickets.filter(t => t.status === "staged").length;
        const openCount = liveTickets.length - stagedCount;
        return (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-baseline gap-3 flex-wrap">
              <span>🎯 Live opportunities — timing decisions in flight</span>
              <span className="stat-label font-normal">
                {groups.length} unique · {stagedCount} staged + {openCount} fired ({liveTickets.length} tickets) · system fires at green
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {groups.map(g => (
                <OpenBetCard key={g.key} group={g} />
              ))}
            </div>
          </section>
        );
      })()}

      {/* SETTLED HISTORY — today only. Older rows live in /stats (day-by-day
          rollup) and /analytics (per-strategy deep dive); duplicating the full
          settled log here just made this tab scroll forever. */}
      {loading ? <div className="text-ink-2">Loading…</div>
        : tickets.length === 0 ? (
          <div className="panel p-10 text-center text-ink-2">
            No tickets yet. Strategies fire automatically when their thresholds are met.
            <div className="mt-3"><Link className="btn-primary" href="/">Open Race Radar</Link></div>
          </div>
        ) : (() => {
          const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
          const todayStartMs = startOfToday.getTime();
          const todayHistory = tickets.filter(t =>
            (t.status === "won" || t.status === "lost" || t.status === "void")
            && t.placedAt >= todayStartMs);
          return (
            <section>
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                <h2 className="text-sm font-semibold">History — today</h2>
                <div className="text-[11px] text-ink-2">
                  Older days: <Link href="/stats" className="text-accent-cyan hover:underline">Results</Link>
                  {" · "}
                  <Link href="/analytics" className="text-accent-cyan hover:underline">Analytics</Link>
                </div>
              </div>
              {todayHistory.length === 0 ? (
                <div className="panel p-6 text-center text-ink-2 text-sm">
                  Nothing settled today yet.
                  <div className="mt-2 text-[11px]">
                    See <Link href="/stats" className="text-accent-cyan hover:underline">Results</Link> for prior days
                    or <Link href="/analytics" className="text-accent-cyan hover:underline">Analytics</Link> for per-strategy breakdown.
                  </div>
                </div>
              ) : (
                <div className="panel divide-y divide-line/40">
                  {todayHistory.map(t => <TicketRow key={t.id} ticket={t}/>)}
                </div>
              )}
            </section>
          );
        })()}
    </div>
  );
}

interface OpenBetGroup {
  key: string;
  raceId: string;
  trackCode: string;
  trackName: string;
  raceNumber: number;
  postTime: number;
  type: Ticket["type"];
  selection: string;
  horseName: string;
  capturedOdds: number;
  // Model-estimated true win probability at fire time (frozen alongside
  // capturedOdds). Used to show model-prob drift separately from odds drift.
  capturedTrueP: number | null;
  // Strategy id used to calibrate the live "model fair" / "live EV" display.
  // Prefers tvg-baseline when present (most conservative calibration in the
  // stack) so consensus groups don't flip between views. Null for manual
  // tickets, which fall back to the adapter's raw blend.
  calibrationStrategyId: string | null;
  totalStake: number;          // sum across all strategy tickets in this group
  strategies: { id: string; ev: number; reason?: string }[];
  tickets: Ticket[];           // the underlying tickets (one per agreeing strategy)
}

const MULTI_LEG_TYPES = new Set<Ticket["type"]>(["DD", "P3", "P4", "P5", "P6", "J6"]);
const MULTI_PICK_TYPES = new Set<Ticket["type"]>(["EXACTA", "TRIFECTA"]);
function isMultiLeg(type: Ticket["type"]): boolean { return MULTI_LEG_TYPES.has(type); }
function isMultiPick(type: Ticket["type"]): boolean { return MULTI_PICK_TYPES.has(type); }
// Human-readable name for a bet type code. Handicappers know "P3" but the
// friendly label removes any ambiguity for someone new to the platform.
const BET_TYPE_LABELS: Record<Ticket["type"], string> = {
  WIN: "Win",
  PLACE: "Place",
  SHOW: "Show",
  EXACTA: "Exacta",
  TRIFECTA: "Trifecta",
  DD: "Daily Double",
  P3: "Pick 3",
  P4: "Pick 4",
  P5: "Pick 5",
  P6: "Pick 6",
  J6: "Jackpot 6",
};
function betTypeLabel(type: Ticket["type"]): string {
  return BET_TYPE_LABELS[type] ?? type;
}
// True when the bet's selection isn't a single runner — either multi-leg
// (DD/Pick-N) or multi-pick in-race (EXACTA/TRIFECTA). Used to bypass the
// single-runner timer/odds lookup that would otherwise return null for
// flattened selections like "3-5" (exacta box) or "3-3-4-9-5" (Pick-5).
function isExoticTicket(type: Ticket["type"]): boolean {
  return isMultiLeg(type) || isMultiPick(type);
}

function groupOpenBets(open: Ticket[]): OpenBetGroup[] {
  const map = new Map<string, OpenBetGroup>();
  for (const t of open) {
    const sel = t.selections.join("-");
    const key = `${t.raceId}|${t.type}|${sel}`;
    const sid = t.strategyId ?? "manual";
    const existing = map.get(key);
    if (existing) {
      existing.totalStake += t.stake;
      const prior = existing.strategies.find(s => s.id === sid);
      if (prior) {
        // Same strategy fired twice for this selection (e.g. open + action phase).
        // Keep one entry so it doesn't masquerade as cross-strategy consensus and
        // doesn't collide as a React key on the chip list.
        if (t.capturedEV > prior.ev) { prior.ev = t.capturedEV; prior.reason = t.reason; }
      } else {
        existing.strategies.push({ id: sid, ev: t.capturedEV, reason: t.reason });
      }
      // Prefer tvg-baseline's calibration for the group display when it's
      // one of the firing strategies — its 30%-weight trueP is more
      // conservative than the adapter blend other strategies use.
      if (t.strategyId === "tvg-baseline") existing.calibrationStrategyId = "tvg-baseline";
      existing.tickets.push(t);
    } else {
      map.set(key, {
        key,
        raceId: t.raceId,
        trackCode: t.trackCode ?? "",
        trackName: t.trackName ?? t.trackCode ?? "",
        raceNumber: t.raceNumber ?? 0,
        postTime: t.postTime ?? t.placedAt,
        type: t.type,
        selection: sel,
        horseName: t.horseName ?? "",
        capturedOdds: t.capturedOdds,
        capturedTrueP: t.capturedTrueP ?? null,
        calibrationStrategyId: t.strategyId ?? null,
        totalStake: t.stake,
        strategies: [{ id: sid, ev: t.capturedEV, reason: t.reason }],
        tickets: [t],
      });
    }
  }
  // Sort: closest to post first
  return [...map.values()].sort((a, b) => a.postTime - b.postTime);
}

function OpenBetCard({ group: g }: { group: OpenBetGroup }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(i);
  }, []);

  // Lifecycle state of the underlying tickets. A group is "staged" if every
  // ticket is still waiting on the optimal-timer; "fired" once any has been
  // promoted. capturedOdds on staged tickets is the match-time odds (not the
  // fire-time odds), so we suppress drift display in that case.
  const allStaged = g.tickets.every(t => t.status === "staged");
  const multiLeg = isMultiLeg(g.type);
  const multiPick = isMultiPick(g.type);
  // Either kind of exotic bypasses single-runner odds/timer lookup.
  const exotic = multiLeg || multiPick;

  // Live race + runner from the SSE stream — drives current odds + timing decision.
  // Skip the runner lookup entirely for exotic wagers: g.selection is a
  // flattened cross-leg / multi-pick concat (e.g. "3-3-4-9-5" or "3-5") and
  // won't match any single runner program, which would otherwise produce a
  // spurious "no live data". For multi-pick exotics we use the first
  // selection (the "key" horse) as a fallback so we can still render a chalk
  // marker for the marquee horse.
  const liveRace = useToteflow(s => s.races.find(r => r.id === g.raceId));
  const keyProgram = multiPick ? g.tickets[0]?.selections[0] : g.selection;
  const liveRunner = !exotic
    ? (liveRace?.runners.find(r => r.program === g.selection) ?? null)
    : null;
  const keyRunner = multiPick
    ? (liveRace?.runners.find(r => r.program === keyProgram) ?? null)
    : null;
  void keyRunner;

  const msToPost = g.postTime - Date.now();
  const expired = msToPost < -60_000;
  const urgent = msToPost > 0 && msToPost < 2 * 60_000;
  const m = Math.floor(Math.abs(msToPost) / 60_000);
  const s = Math.floor((Math.abs(msToPost) % 60_000) / 1000);
  const postLabel = expired
    ? `OFF ${m}m ago`
    : msToPost < 0
      ? `OFF (${s}s ago)`
      : `Post in ${m}:${String(s).padStart(2,"0")}`;

  const liveOdds = liveRunner?.currentOdds ?? null;
  // Odds drift since the bot fired — positive means odds tightened (less value).
  // Skip when fully staged: the recorded odds are from strategy-match time, not
  // an actual fire, so labeling drift "since fire" would be a lie.
  const oddsDriftPct = !allStaged && liveOdds != null && g.capturedOdds > 0
    ? ((g.capturedOdds - liveOdds) / g.capturedOdds) * 100
    : null;

  // Model view — recomputed with the FIRING strategy's calibration so it
  // matches the reason line and captured EV. `truePWin` on the runner is
  // the adapter's raw blend (65% weight on the model for "high" quality
  // races); tvg-baseline gates on a 30%-weight recalibration and the
  // display must show the same probability the strategy is using, not the
  // adapter's more aggressive view. See lib/strategy-calibration.ts.
  const liveTakeout = liveRace?.takeout ?? null;
  const adapterLiveTrueP = liveRunner?.truePWin ?? null;
  const liveMarketP = liveOdds != null && liveOdds > 0 ? 1 / liveOdds : null;
  const liveTrueP = adapterLiveTrueP != null && liveMarketP != null
    ? strategyCalibratedTrueP(g.calibrationStrategyId, adapterLiveTrueP, liveMarketP)
    : null;
  // Live model EV — recomputed from the strategy's calibrated trueP so the
  // "live EV" number tracks the same probability the strategy is using.
  // Falls back to the adapter's `evPercent` when the strategy trueP isn't
  // available (e.g. exotic wagers, model-off states) so the number remains
  // meaningful even without a calibration.
  const liveEv = liveTrueP != null && liveOdds != null && liveTakeout != null
    ? evPercentFromTrueP(liveTrueP, liveOdds, liveTakeout)
    : liveRunner?.evPercent ?? null;

  // Optimal-timer is single-runner logic — exotic wagers (multi-leg DD/Pick-N
  // and multi-pick EXACTA/TRIFECTA) don't have a meaningful single-runner
  // fire window to manage. Bypass it. Pass calibrated EV so the EV floor check
  // uses the same probability the strategy gates on, not the uncalibrated adapter blend.
  const decision = exotic
    ? null
    : decideBetWindow({ race: liveRace ?? null, runner: liveRunner, msToPost, calibratedEv: liveEv ?? undefined });
  const modelOn = isModelContributing(liveTrueP, liveOdds);
  const fairDecimal = modelOn ? modelFairDecimal(liveTrueP, liveTakeout) : null;
  // Overpricing % = (market − fair) / fair. Positive = market is longer
  // than model thinks it should be (better payout than fair → underpriced,
  // good bet). Negative = market shorter than fair (overpriced, bad bet).
  const marketVsFairPct = fairDecimal != null && liveOdds != null
    ? ((liveOdds - fairDecimal) / fairDecimal) * 100
    : null;
  const trueDriftPp = !allStaged && liveTrueP != null && g.capturedTrueP != null
    ? (liveTrueP - g.capturedTrueP) * 100
    : null;

  // Exotic rendering data: per-leg breakdown (DD/Pick-N) OR per-pick listing
  // (EXACTA/TRIFECTA) + cost arithmetic. Pulled from the first ticket — all
  // tickets in a group share the same selection by key.
  const t0 = g.tickets[0];
  const legs = multiLeg ? (t0.legs ?? []) : [];
  const exoticCombos = multiLeg
    ? (legs.length ? legs.reduce((a, l) => a * Math.max(1, l.selections.length), 1) : 0)
    : multiPick
      ? (g.type === "TRIFECTA" ? 6 : 2)
      : 0;
  const basePrice = exoticCombos > 0 ? t0.stake / exoticCombos : 0;
  const estPayout = exotic ? t0.potentialPayout : 0;

  const source = sourceFromRaceId(g.raceId);
  const links = verificationLinks({
    source,
    trackCode: g.trackCode,
    trackName: g.trackName,
    raceNumber: g.raceNumber,
    postTime: g.postTime,
  });
  const fanduel = links.find(l => l.label === "FanDuel Racing 💰");
  const watchLinks = links.filter(l => l.label.startsWith("📺"));
  const otherLinks = links.filter(l => l !== fanduel && !l.label.startsWith("📺"));
  const consensus = g.strategies.length >= 2;
  const avgEv = g.strategies.reduce((a, s) => a + s.ev, 0) / g.strategies.length;
  void tick;

  // Border color follows the timing status — WAIT softens the urgency, BET_NOW/LOCKED lights it up,
  // ABORT dims and reds the whole card so the eye skips it. Exotic tickets
  // skip the timer entirely; pick a neutral border based on urgency/consensus.
  const borderCls = expired ? "border-line opacity-50"
    : exotic ? (consensus ? "border-accent-overlay/60 ring-1 ring-accent-overlay/30"
                : urgent ? "border-accent-warn/60 ring-1 ring-accent-warn/30"
                : "border-accent-cyan/40")
    : decision!.status === "ABORT" ? "border-accent-steam/50 opacity-60"
    : decision!.status === "LOCKED" ? "border-accent-steam ring-1 ring-accent-steam/40 animate-chaos-pulse"
    : decision!.status === "BET_NOW" ? "border-accent-warn/70 ring-1 ring-accent-warn/40"
    : decision!.status === "WAIT" ? "border-ink-2/40"
    : decision!.status === "STALE" ? "border-line"
    : consensus ? "border-accent-overlay/60 ring-1 ring-accent-overlay/30"
    : urgent ? "border-accent-warn/60 ring-1 ring-accent-warn/30"
    : "border-accent-cyan/40";

  return (
    <div className={clsx("panel p-4 space-y-3 border", borderCls)}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex flex-wrap items-baseline gap-1.5 text-[10px] font-mono uppercase tracking-wider">
          {allStaged && (
            <span className="chip border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan">
              staged
            </span>
          )}
          {consensus && (
            <span className="chip border border-accent-overlay/40 bg-accent-overlay/15 text-accent-overlay">
              {g.strategies.length} strategies agree
            </span>
          )}
          {g.strategies.map(s => (
            <span key={s.id} className="text-ink-2">
              {s.id} <span className="text-ink-1">{allStaged ? "match" : "fire"} {s.ev >= 0 ? "+" : ""}{s.ev.toFixed(1)}%</span>
            </span>
          )).reduce((acc: React.ReactNode[], el, i) =>
            i === 0 ? [el] : [...acc, <span key={`d${i}`} className="text-ink-2">·</span>, el], [])}
          {(exotic || allStaged || liveEv == null) && (
            <EVExplainer
              context="live"
              trueP={liveTrueP}
              odds={liveOdds}
              takeout={liveRace?.takeout ?? null}
              liveEv={liveEv}
              capturedEv={avgEv}
            />
          )}
        </div>
        <div className={clsx("text-xs font-mono tabular-nums",
          expired ? "text-ink-2" :
          urgent ? "text-accent-warn font-semibold" : "text-accent-cyan")}>
          {postLabel}
        </div>
      </div>

      {!expired && !exotic && <BetWindowBanner decision={decision!} />}

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wider text-ink-2">Track</div>
        <div className="text-lg font-display">{g.trackName} <span className="text-ink-2 text-sm font-mono">({g.trackCode})</span> <span className="text-ink-2 text-sm">· Race {g.raceNumber}</span></div>
      </div>

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wider text-ink-2">
          {multiLeg ? `Place this ${betTypeLabel(g.type)} ticket`
            : multiPick ? `Place this ${betTypeLabel(g.type)} box`
            : allStaged ? "Staged opportunity" : "Place this bet"}
        </div>
        <div className="text-xl font-display font-semibold">
          <span className="chip border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan mr-2">{betTypeLabel(g.type)}</span>
          {exotic ? (
            <>${g.totalStake.toFixed(2)} ticket · <span className="text-ink-2 text-base font-normal">{exoticCombos} combo{exoticCombos === 1 ? "" : "s"} × ${basePrice.toFixed(2)}</span></>
          ) : allStaged
            ? <span className="text-ink-2 text-base">Pending — fires at green</span>
            : <>${g.totalStake} on <span className="text-accent-overlay">#{g.selection}</span></>}
        </div>
        {multiLeg ? (
          <div className="text-sm space-y-0.5">
            {legs.map((leg, i) => (
              <div key={i} className="flex items-baseline gap-2 font-mono">
                <span className="text-ink-2 text-[11px] uppercase tracking-wider w-12">Leg {i + 1}</span>
                <span className="text-ink-2 text-xs w-10">R{leg.raceNumber}</span>
                <span className="text-accent-overlay">
                  {leg.selections.map(s => `#${s}`).join(", ")}
                </span>
                {leg.selections.length > 1 && (
                  <span className="text-ink-2 text-xs">({leg.selections.length} horses)</span>
                )}
              </div>
            ))}
            {estPayout > 0 && (
              <div className="text-[11px] text-ink-2 pt-1">
                est payout if hit: <span className="text-accent-overlay font-mono">${estPayout.toFixed(0)}</span>
                <span className="text-ink-2"> · carryover edge </span>
                <span className="text-accent-overlay font-mono">+{g.strategies[0]?.ev.toFixed(1)}%</span>
              </div>
            )}
          </div>
        ) : multiPick ? (
          <div className="text-sm space-y-0.5">
            <div className="font-mono text-accent-overlay">
              Box: {t0.selections.map(p => `#${p}`).join(" / ")}
            </div>
            {estPayout > 0 && (
              <div className="text-[11px] text-ink-2 pt-1">
                est payout if hit: <span className="text-accent-overlay font-mono">${estPayout.toFixed(0)}</span>
                <span className="text-ink-2"> · model edge </span>
                <span className="text-accent-overlay font-mono">+{g.strategies[0]?.ev.toFixed(1)}%</span>
                <span className="text-ink-2"> · (paper, est from pool + Harville)</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="text-ink-1 text-sm flex flex-wrap items-baseline gap-x-2">
              <span>{g.horseName} {allStaged && <span className="text-ink-2 text-xs">(#{g.selection})</span>}</span>
              {liveOdds != null ? (
                <span className="font-mono">
                  <span className="text-ink-0">@ {decimalToFractional(liveOdds)}</span>
                  <span className="text-ink-2 ml-2">live</span>
                  {oddsDriftPct != null && Math.abs(oddsDriftPct) >= 1 && (
                    <span className={clsx("ml-2 text-xs",
                      oddsDriftPct > 0 ? "text-accent-steam" : "text-accent-overlay")}>
                      {oddsDriftPct > 0 ? "▼" : "▲"} from {decimalToFractional(g.capturedOdds)} ({oddsDriftPct > 0 ? "-" : "+"}{Math.abs(oddsDriftPct).toFixed(0)}%)
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-ink-2 font-mono">
                  @ {g.capturedOdds > 0 ? decimalToFractional(g.capturedOdds) : "?"}
                  <span className="text-[10px]"> {allStaged ? "at match" : "at fire"}</span>
                </span>
              )}
            </div>
            {!allStaged && liveOdds != null && (fairDecimal != null || liveTrueP != null) && (
              <div className="text-[11px] font-mono flex flex-wrap items-baseline gap-x-2">
                {fairDecimal != null ? (
                  <>
                    <span className="text-ink-2">model fair:</span>
                    <span className="text-ink-0">{decimalToFractional(fairDecimal)}</span>
                    {marketVsFairPct != null && Math.abs(marketVsFairPct) >= 5 && (
                      <span className={clsx(
                        marketVsFairPct > 0 ? "text-accent-overlay" : "text-accent-steam"
                      )}>
                        market {marketVsFairPct > 0 ? "underpriced" : "overpriced"} by {Math.abs(marketVsFairPct).toFixed(0)}%
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-accent-warn" title="TVG adapter drops the model when decimal odds cross 60 (~59/1), or when the race-level model quality is low. Live EV falls back to market-implied probability, which is always ≈ −takeout.">
                    model off — long-shot cutoff (odds &gt; 60/1)
                  </span>
                )}
                {trueDriftPp != null && Math.abs(trueDriftPp) >= 0.3 && g.capturedTrueP != null && liveTrueP != null && (
                  <span className={clsx("text-ink-2",
                    trueDriftPp < 0 ? "text-accent-steam" : "text-accent-overlay")}>
                    {" · "}model p {trueDriftPp > 0 ? "▲" : "▼"} {(g.capturedTrueP * 100).toFixed(1)}% → {(liveTrueP * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            )}
          </>
        )}
        {!exotic && (
          <div className="text-[11px] font-mono space-y-0.5">
            {!allStaged && liveEv != null && (
              <div>
                <span className="text-ink-2">live EV: </span>
                <span className={clsx(
                  liveEv < -5 ? "text-accent-steam font-semibold" :
                  liveEv < 0 ? "text-accent-warn" :
                  "text-accent-overlay"
                )}>
                  {liveEv >= 0 ? "+" : ""}{liveEv.toFixed(1)}%
                </span>
                <EVExplainer
                  context="live"
                  trueP={liveTrueP}
                  odds={liveOdds}
                  takeout={liveRace?.takeout ?? null}
                  liveEv={liveEv}
                />
                {Math.abs(liveEv - avgEv) >= 1 && (
                  <span className="text-ink-2 ml-2">
                    {liveEv > avgEv ? "▲" : "▼"} from {avgEv >= 0 ? "+" : ""}{avgEv.toFixed(1)}% at fire
                    {" "}({liveEv > avgEv ? "+" : ""}{(liveEv - avgEv).toFixed(1)}pp)
                  </span>
                )}
              </div>
            )}
            {!allStaged && expired && liveEv == null && (
              <div>
                <span className="text-ink-2">captured EV: </span>
                <span className={clsx(
                  avgEv < -5 ? "text-accent-steam font-semibold" :
                  avgEv < 0 ? "text-accent-warn" :
                  "text-accent-overlay"
                )}>
                  {avgEv >= 0 ? "+" : ""}{avgEv.toFixed(1)}%
                </span>
                <EVExplainer
                  context="history"
                  capturedEv={avgEv}
                />
              </div>
            )}
            {allStaged && liveOdds != null && (liveTrueP != null || fairDecimal != null) && (
              <div className="space-y-0.5">
                <div className="text-ink-2">
                  model view (right now):
                </div>
                {liveTrueP != null && (
                  <div>
                    <span className="text-ink-2">P win: </span>
                    <span className="text-ink-0">{(liveTrueP * 100).toFixed(1)}%</span>
                    <span className="text-ink-2 ml-1">({decimalToFractional(1 / liveTrueP)})</span>
                  </div>
                )}
                <div>
                  <span className="text-ink-2">live: </span>
                  <span className="text-ink-0">{decimalToFractional(liveOdds)}</span>
                  <span className="text-ink-2 ml-1">({(100 / liveOdds).toFixed(2)}%)</span>
                </div>
                {fairDecimal != null && (
                  <div>
                    <span className="text-ink-2">fair: </span>
                    <span className="text-ink-0">{decimalToFractional(fairDecimal)}</span>
                    <span className="text-ink-2 ml-1">({(100 / fairDecimal).toFixed(2)}%)</span>
                    {marketVsFairPct != null && Math.abs(marketVsFairPct) >= 1 && (
                      <span className={clsx("ml-2",
                        marketVsFairPct > 0 ? "text-accent-overlay" : "text-accent-steam"
                      )}>
                        {marketVsFairPct > 0 ? "↑ underpriced" : "↓ overpriced"} {Math.abs(marketVsFairPct).toFixed(0)}%
                      </span>
                    )}
                  </div>
                )}
                {liveEv != null && (
                  <div>
                    <span className="text-ink-2">model EV now: </span>
                    <span className={clsx(
                      liveEv < -5 ? "text-accent-steam font-semibold" :
                      liveEv < 0 ? "text-accent-warn" :
                      "text-accent-overlay"
                    )}>
                      {liveEv >= 0 ? "+" : ""}{liveEv.toFixed(1)}%
                    </span>
                    {Math.abs(liveEv - avgEv) >= 0.5 && (
                      <span className="text-ink-2 ml-2">
                        {liveEv > avgEv ? "▲" : "▼"} from {avgEv >= 0 ? "+" : ""}{avgEv.toFixed(1)}% at match
                      </span>
                    )}
                    <EVExplainer
                      context="live"
                      trueP={liveTrueP}
                      odds={liveOdds}
                      takeout={liveRace?.takeout ?? null}
                      liveEv={liveEv}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {consensus && (
          <div className="text-[11px] text-ink-2">
            avg EV at fire: <span className="text-accent-overlay">+{avgEv.toFixed(1)}%</span> across {g.strategies.length} strategies
            {" · "}stake combines {g.strategies.length} × ${g.tickets[0].stake} tickets
          </div>
        )}
      </div>

      {fanduel && !expired && !exotic && decision!.status === "ABORT" && (
        <div className="block w-full text-center px-4 py-2.5 rounded-md font-semibold bg-bg-2 border border-accent-steam/40 text-accent-steam">
          🛑 Do not bet — EV went negative
        </div>
      )}

      {fanduel && !expired && !exotic && decision!.status !== "ABORT" && (() => {
        const ctaCls =
          decision!.status === "LOCKED" ? "bg-accent-steam text-bg-1 hover:brightness-110 animate-pulse" :
          decision!.status === "BET_NOW" ? "bg-accent-warn text-bg-1 hover:brightness-110" :
          decision!.status === "WAIT" ? "bg-bg-2 border border-ink-2/40 text-ink-2 hover:text-ink-1" :
          urgent ? "bg-accent-warn text-bg-1 hover:brightness-110" :
          "bg-accent-cyan text-bg-1 hover:brightness-110";
        const ctaLabel =
          decision!.status === "WAIT" ? "Open on FanDuel Racing (holding — see above) ↗" :
          decision!.status === "LOCKED" ? "🚨 FIRE NOW — FanDuel Racing ↗" :
          decision!.status === "BET_NOW" ? "💰 Open on FanDuel Racing ↗" :
          "💰 Open on FanDuel Racing ↗";
        return (
          <a href={fanduel.url} target="_blank" rel="noreferrer"
             className={clsx("block w-full text-center px-4 py-2.5 rounded-md font-semibold transition-colors", ctaCls)}>
            {ctaLabel}
          </a>
        );
      })()}

      {fanduel && !expired && exotic && (
        <a href={fanduel.url} target="_blank" rel="noreferrer"
           className="block w-full text-center px-4 py-2.5 rounded-md font-semibold bg-accent-cyan text-bg-1 hover:brightness-110 transition-colors">
          💰 Open on FanDuel Racing ↗
        </a>
      )}

      {watchLinks.length > 0 && !expired && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {watchLinks.map(l => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
               title={l.description}
               className="px-2 py-1 rounded border border-line text-ink-1 hover:border-accent-cyan/40 hover:text-accent-cyan">
              {l.label} ↗
            </a>
          ))}
        </div>
      )}

      {expired && (
        <div className="text-xs text-ink-2 italic">
          Race already off — can't place this one. Awaiting result for grading.
        </div>
      )}

      <details className="text-[11px]">
        <summary className="cursor-pointer text-ink-2 font-mono uppercase tracking-wider hover:text-ink-1">
          why · cross-check · raceId
        </summary>
        <div className="mt-2 space-y-1.5 text-ink-1">
          {g.strategies.filter(s => s.reason).map((s, i) => (
            <div key={i} className="italic">
              <span className="text-ink-2 font-mono not-italic">[{s.id}]</span> {s.reason}
            </div>
          ))}
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
            {otherLinks.map(l => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
                 title={l.description}
                 className="text-accent-cyan/80 hover:text-accent-cyan hover:underline">
                {l.label} ↗
              </a>
            ))}
          </div>
          <div className="text-ink-2 font-mono">raceId={g.raceId} · {g.tickets.length} ticket{g.tickets.length === 1 ? "" : "s"} ({g.tickets.map(t => t.id.slice(-5)).join(", ")})</div>
        </div>
      </details>
    </div>
  );
}

function EVExplainer({
  trueP, odds, takeout, liveEv,
  capturedEv, closingEv,
  context,
}: {
  trueP?: number | null;
  odds?: number | null;
  takeout?: number | null;
  liveEv?: number | null;
  capturedEv?: number | null;
  closingEv?: number | null;
  context: "live" | "history";
}) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const haveLive = trueP != null && odds != null && takeout != null;
  const TOOLTIP_W = 288; // matches w-72

  function open() {
    const el = iconRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Estimate height — we don't know the rendered size yet. Tooltip is
    // capped by content; 240px covers the worst case (live with all rows).
    const estH = 240;

    // Vertical: prefer below the icon, flip above if it would overflow.
    let top = r.bottom + 6;
    if (top + estH > vh - margin) top = Math.max(margin, r.top - estH - 6);

    // Horizontal: align with icon's left edge, clamp to viewport.
    let left = r.left;
    if (left + TOOLTIP_W > vw - margin) left = vw - TOOLTIP_W - margin;
    if (left < margin) left = margin;

    setPos({ left, top });
  }
  function close() { setPos(null); }

  return (
    <>
      <span
        ref={iconRef}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        tabIndex={0}
        className="cursor-help text-ink-2 hover:text-ink-1 text-[10px] font-mono border border-line/60 hover:border-ink-2 rounded-full w-3.5 h-3.5 inline-flex items-center justify-center ml-1 select-none align-middle"
        aria-label="How EV is calculated"
      >i</span>
      {pos && typeof document !== "undefined" && createPortal(
        <div
          style={{ position: "fixed", left: pos.left, top: pos.top, width: TOOLTIP_W }}
          className="z-[1000] p-2.5 rounded-md bg-bg-1 border border-line/80 shadow-xl text-[11px] leading-snug text-ink-1 normal-case tracking-normal font-normal pointer-events-none"
        >
          {context === "live" && haveLive && (() => {
            const fair = modelFairDecimal(trueP!, takeout!);
            const modelOn = isModelContributing(trueP!, odds!);
            return (
              <div className="space-y-0.5 font-mono text-[10.5px] text-ink-1">
                <div className="stat-label text-ink-2 mb-1 not-italic">This bet, right now</div>
                <div>P (true win prob) = <span className="text-ink-0">{(trueP! * 100).toFixed(1)}%</span></div>
                <div>odds = <span className="text-ink-0">{odds!.toFixed(2)}</span> <span className="text-ink-2">({decimalToFractional(odds!)})</span></div>
                <div>takeout = <span className="text-ink-0">{(takeout! * 100).toFixed(0)}%</span></div>
                {fair != null && (
                  <div>
                    fair odds = <span className="text-ink-0">{fair.toFixed(2)}</span>{" "}
                    <span className="text-ink-2">({decimalToFractional(fair)})</span>
                    <span className="text-ink-2"> — break-even from P + takeout</span>
                  </div>
                )}
                {!modelOn && (
                  <div className="text-accent-warn">
                    model off — P snapped to market-implied. EV ≈ −takeout by construction.
                  </div>
                )}
                <div className="pt-1">
                  ({trueP!.toFixed(3)} × {(odds! - 1).toFixed(2)} × {(1 - takeout!).toFixed(2)} − {(1 - trueP!).toFixed(3)}) × 100
                </div>
                {liveEv != null && (
                  <div>
                    = <span className={clsx("font-semibold",
                        liveEv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                        {liveEv >= 0 ? "+" : ""}{liveEv.toFixed(1)}%
                      </span>
                  </div>
                )}
              </div>
            );
          })()}
          {context === "live" && !haveLive && (
            <div className="text-ink-2 text-[10.5px] italic">
              Live model inputs not available for this bet — showing formula only.
            </div>
          )}
          {context === "history" && (capturedEv != null || closingEv != null) && (
            <div className="text-[10.5px] text-ink-1 space-y-0.5">
              <div className="stat-label text-ink-2 mb-1 not-italic">This bet</div>
              {capturedEv != null && (
                <div>
                  <span className="font-mono text-ink-2">at fire:</span>{" "}
                  <span className={clsx("font-mono",
                    capturedEv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                    {capturedEv >= 0 ? "+" : ""}{capturedEv.toFixed(1)}%
                  </span>
                  {" "}<span className="text-ink-2">— frozen at strategy match</span>
                </div>
              )}
              {closingEv != null && (
                <div>
                  <span className="font-mono text-ink-2">at close:</span>{" "}
                  <span className={clsx("font-mono",
                    closingEv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                    {closingEv >= 0 ? "+" : ""}{closingEv.toFixed(1)}%
                  </span>
                  {" "}<span className="text-ink-2">
                    — scaled from fire EV by odds drift (constant model prob)
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-2 pt-2 border-t border-line/40 text-[10px] text-ink-2 space-y-1">
            <div className="font-mono text-ink-1 text-[10.5px]">
              EV% = (P × (odds−1) × (1−takeout) − (1−P)) × 100
            </div>
            <div>
              <span className="font-mono text-ink-1">P</span> blends model + market ·{" "}
              <span className="font-mono text-ink-1">odds</span> live decimal ·{" "}
              <span className="font-mono text-ink-1">takeout</span> track pool cut
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function BetWindowBanner({ decision }: { decision: BetWindowDecision }) {
  const cls = decision.status === "ABORT"
    ? "border-accent-steam/60 bg-accent-steam/10 text-accent-steam"
    : decision.status === "LOCKED"
    ? "border-accent-steam/60 bg-accent-steam/10 text-accent-steam"
    : decision.status === "BET_NOW"
    ? "border-accent-warn/60 bg-accent-warn/10 text-accent-warn"
    : decision.status === "WAIT"
    ? "border-accent-cyan/40 bg-accent-cyan/[0.08] text-accent-cyan"
    : decision.status === "STALE"
    ? "border-line bg-bg-2 text-ink-2"
    : "border-line bg-bg-2 text-ink-2";
  const dot = decision.status === "ABORT" ? "🛑"
    : decision.status === "LOCKED" ? "🔴"
    : decision.status === "BET_NOW" ? "🟡"
    : decision.status === "WAIT" ? "🟢"
    : decision.status === "STALE" ? "⚪"
    : "·";
  return (
    <div className={clsx("rounded-md border px-3 py-2 flex items-start gap-2", cls)}>
      <span className="text-base leading-none mt-0.5">{dot}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold tracking-wide">{decision.headline}</div>
        <div className="text-[11px] opacity-80 font-mono leading-snug">{decision.detail}</div>
      </div>
    </div>
  );
}

// Break-even decimal odds implied by the model. Derived from the same EV
// formula the adapter uses (EV = trueP × (odds−1) × (1−takeout) − (1−trueP)):
// setting EV = 0 gives odds = 1 + (1 − trueP) / (trueP × (1 − takeout)).
// Returns null when inputs are missing or degenerate.
function modelFairDecimal(trueP: number | null | undefined, takeout: number | null | undefined): number | null {
  if (trueP == null || trueP <= 0 || trueP >= 1) return null;
  if (takeout == null || takeout >= 1 || takeout < 0) return null;
  return 1 + (1 - trueP) / (trueP * (1 - takeout));
}

// True when the model is actually contributing to trueP. The TVG adapter
// snaps trueP to marketImpliedP whenever decimal odds cross the 60/1
// long-shot cutoff (or the horse is scratched, or the race-level model
// quality is "low"). Detecting the collapse in the UI lets us flag "model
// off — long-shot cutoff" instead of letting the fair-odds line silently
// echo the market price back.
function isModelContributing(trueP: number | null | undefined, decimalOdds: number | null | undefined): boolean {
  if (trueP == null || decimalOdds == null || decimalOdds <= 1) return false;
  const marketImpliedP = 1 / Math.max(1.2, decimalOdds);
  return Math.abs(trueP - marketImpliedP) > 0.002;
}

function decimalToFractional(d: number): string {
  if (!d || d <= 1) return "?";
  const dec = d - 1;
  // Approximate to common fractions
  const pairs: [number, [number, number]][] = [];
  for (let den = 1; den <= 10; den++) {
    for (let num = 1; num <= 99; num++) {
      pairs.push([num / den, [num, den]]);
    }
  }
  let best = pairs[0];
  let bestErr = Math.abs(best[0] - dec);
  for (const p of pairs) {
    const err = Math.abs(p[0] - dec);
    if (err < bestErr) { best = p; bestErr = err; }
  }
  return `${best[1][0]}/${best[1][1]}`;
}

function Stat({ label, value, color = "text-ink-0", title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div className="text-left sm:text-right" title={title}>
      <div className="stat-label">{label}</div>
      <div className={`font-mono tabular-nums font-semibold text-sm sm:text-base ${color}`}>{value}</div>
    </div>
  );
}

function LogPanel({ title, entries }: { title: string; entries: { ts: number; msg: string }[] }) {
  return (
    <div className="panel-tight p-3">
      <div className="stat-label mb-1">{title}</div>
      <ul className="space-y-0.5 max-h-48 overflow-y-auto">
        {entries.length === 0 && <li className="text-ink-2 text-xs">no events yet</li>}
        {entries.map((e, i) => (
          <li key={i} className="text-[11px] font-mono text-ink-1 leading-tight">
            <span className="text-ink-2">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>{" "}
            {e.msg}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TicketRow({ ticket: t }: { ticket: Ticket }) {
  const settled = t.status === "won" || t.status === "lost";
  // Measure-only strategies (e.g. pure-steam) book every bet as a $0 shadow, so
  // realizedPL is always 0 and the real outcome lives in shadowPL. Show that
  // hypothetical instead — otherwise a winner reads as a misleading "+$0.00".
  const measureOnly = isMeasureOnly(t.strategyId);
  const pl = measureOnly ? (t.shadowPL ?? 0) : (t.realizedPL ?? 0);
  const modeLabel = measureOnly ? "measure" : t.shadow ? "shadow" : t.mode;
  const modeTitle = measureOnly
    ? "Measure-only: this strategy books every bet as a $0 shadow by design — it never touches the bankroll. P/L shown is the hypothetical result at its shadow stake; the aggregate lives in the shadowed slice on Analytics."
    : t.shadow
      ? "Shadow: another strategy already covered this bet — tracked for attribution, no bankroll"
      : undefined;
  const plTitle = measureOnly
    ? "Hypothetical P/L at the strategy's shadow stake — measure-only, never touches the bankroll"
    : undefined;
  // CLV = WIN-only — the closing snapshot stores WIN-pool odds; PLACE/SHOW/
  // exotic bets aren't scored against that pool.
  const clv = t.type === "WIN" && t.closingOdds && t.capturedOdds
    ? ((t.capturedOdds - t.closingOdds) / t.closingOdds) * 100
    : null;
  // NOTE: no client-side P/EV consistency check here. It can't be done
  // honestly — the fire-time takeout isn't persisted on the ticket, so any
  // recompute guesses 0.16 and false-flags tracks like Tampa (18.5%) or
  // Santa Anita (15.43%). It also mis-applied the WIN formula to PLACE/SHOW
  // (Dr.Z pool math). Capture-time consistency is enforced server-side in
  // autobook (P and EV paired atomically from the same strategy re-eval).
  // Closing EV grades the bet WE locked in.
  // - WIN: derive by scaling captured EV by the odds drift (constant-trueP:
  //   same horse, same model probability, just rescaled payout). We prefer
  //   the derivation over any stored value because old rows carried the
  //   race-off market-price EV, which collapses to ~-takeout on bombs.
  // - PLACE: use the stored value directly. It's the Dr.Z Ziemba/Hausch EV
  //   re-computed against the closing PLACE-pool composition, snapshotted
  //   pre-off by autobook. No simple scaling exists for PLACE — the EV
  //   depends on the full pool, not just this horse's odds.
  const derivedClosingEV = t.type === "WIN"
    && t.closingOdds && t.closingOdds > 0
    && t.capturedOdds && t.capturedOdds > 0
    ? (t.capturedEV + 100) * (t.closingOdds / t.capturedOdds) - 100
    : null;
  const effectiveClosingEV = derivedClosingEV ?? t.closingEV ?? null;
  const showClosingEV = (t.type === "WIN" || t.type === "PLACE") && effectiveClosingEV != null;
  // Booked = the odds we promoted at (what a human would have gotten on FanDuel).
  // Final  = the closing tote odds (what the payout was actually computed from).
  // The gap between them is CLV; we surface both so the user can audit the gap directly.
  const bookedOdds = t.capturedOdds > 0 ? decimalToFractional(t.capturedOdds) : "—";
  const finalOdds = t.closingOdds && t.closingOdds > 0 ? decimalToFractional(t.closingOdds) : null;
  // PLACE/SHOW don't pay the WIN odds — capturedOdds/closingOdds are the
  // horse's win price and don't belong in this column for those bets. When a
  // place/show bet cashes we know the EXACT price the pool paid:
  // payout/stake = realizedPL/stake + 1. Losers never cashed (no place price);
  // open bets have no tote place quote yet.
  const isPlaceShow = t.type === "PLACE" || t.type === "SHOW";
  const placeVerb = t.type === "SHOW" ? "show" : "place";
  const placePrice = isPlaceShow && t.status === "won" && t.stake > 0 && t.realizedPL != null
    ? t.realizedPL / t.stake + 1
    : null;
  const placeOddsTitle = placePrice != null
    ? `${betTypeLabel(t.type)} price paid — $${((t.realizedPL ?? 0) + t.stake).toFixed(2)} back on $${t.stake.toFixed(0)} from the ${placeVerb} pool`
    : t.status === "lost"
      ? `Did not ${placeVerb} — no payout`
      : `No tote ${placeVerb} price until settled (win odds don't apply to a ${placeVerb} bet)`;
  // Finish order from the grader (top-4). For single-runner bets we can also
  // call out where our pick actually landed.
  const finishOrder = t.winners ?? [];
  const myPick = t.selections[0];
  const myFinishIdx = settled && myPick ? finishOrder.indexOf(myPick) : -1;
  const ordinal = (i: number) =>
    i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;
  const myFinishLabel = myFinishIdx >= 0 ? ordinal(myFinishIdx) : null;
  return (
    <div className="px-3 sm:px-4 py-3 sm:py-2 text-sm">
      {/* MOBILE: stacked card. DESKTOP: 9-column grid (unchanged). */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col min-w-0 gap-0.5">
            <Link href={`/race/${t.raceId}`} className="font-mono truncate">
              <span className="text-accent-cyan">
                {t.trackCode ?? t.raceId} {t.raceNumber ? `R${t.raceNumber}` : ""}
              </span>
              {t.trackName && t.trackName !== t.trackCode && (
                <span className="text-[10px] text-ink-2 normal-case ml-2" title={t.trackName}>
                  {t.trackName}
                </span>
              )}
            </Link>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-2 leading-tight">
              {new Date(t.placedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {" · "}
              {new Date(t.placedAt).toLocaleTimeString([], { hour12: false })}
              {" · "}
              <span className="normal-case">{t.strategyId ?? "manual"}</span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className={clsx("chip border",
              t.shadow
                ? "border-line/60 bg-bg-1 text-ink-2"
                : t.mode === "auto"
                  ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                  : "border-line text-ink-2",
            )} title={modeTitle}>
              {modeLabel}
            </span>
            {!settled ? (
              <span className="chip border border-line text-ink-2">{t.status}</span>
            ) : (
              <span className={clsx("chip border", t.status === "won"
                ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay"
                : "border-accent-steam/40 bg-accent-steam/10 text-accent-steam")}>
                {t.status}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="chip border border-line">{t.type}</span>
          <span className="font-mono">#{t.selections.join("-")}</span>
          {t.horseName && <span className="text-ink-1">{t.horseName}</span>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
          <div>
            <div className="stat-label">stake</div>
            <div className="text-ink-0">${t.stake.toFixed(0)}</div>
          </div>
          <div title={isPlaceShow ? placeOddsTitle : undefined}>
            <div className="stat-label">{isPlaceShow ? `${placeVerb} price` : "odds"}</div>
            <div className="text-ink-1 leading-tight">
              {isPlaceShow ? (
                placePrice != null
                  ? <span className="text-ink-0">{decimalToFractional(placePrice)}</span>
                  : <span className="text-ink-2">—</span>
              ) : (
                <>
                  {bookedOdds}
                  {finalOdds && (
                    <>
                      <span className="text-ink-2 mx-1">→</span>
                      <span className="text-ink-0">{finalOdds}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div>
            <div className="stat-label">EV</div>
            {showClosingEV ? (
              <div className="leading-tight">
                <span className={clsx("font-semibold",
                  effectiveClosingEV! >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                  {effectiveClosingEV! >= 0 ? "+" : ""}{effectiveClosingEV!.toFixed(1)}%
                </span>
                <div className="text-[10px] text-ink-2">was {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%</div>
              </div>
            ) : (
              <span className={clsx(
                t.capturedEV > 0 ? "text-accent-overlay" : "text-accent-steam")}>
                {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {settled && (
          <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap text-xs font-mono tabular-nums">
            <span className={clsx("font-semibold",
              pl >= 0 ? "text-accent-overlay" : "text-accent-steam")} title={plTitle}>
              P/L {measureOnly ? "~" : ""}{pl >= 0 ? "+" : ""}${pl.toFixed(2)}
            </span>
            {clv != null && (
              <span className={clsx(
                clv >= 0 ? "text-accent-overlay/70" : "text-accent-steam/70")}>
                CLV {clv >= 0 ? "+" : ""}{clv.toFixed(1)}%
              </span>
            )}
          </div>
        )}
        {t.reason && (
          <div className="text-[11px] text-ink-2 italic">
            {t.reason}
            {t.stagedEV != null && Math.abs(t.stagedEV - t.capturedEV) > 1 && (
              <div className="mt-1">staged at {t.stagedEV >= 0 ? "+" : ""}{t.stagedEV.toFixed(1)}% EV — price moved before fire</div>
            )}
          </div>
        )}
      </div>

      <div className="hidden sm:grid grid-cols-[100px_60px_110px_110px_minmax(160px,1fr)_60px_100px_74px_100px] gap-3 items-center">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-2 leading-tight flex flex-col">
          <span className="text-ink-1">
            {new Date(t.placedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
          </span>
          <span>{new Date(t.placedAt).toLocaleTimeString([], { hour12: false })}</span>
        </span>
        <span className={clsx("chip border",
          t.shadow
            ? "border-line/60 bg-bg-1 text-ink-2"
            : t.mode === "auto"
              ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
              : "border-line text-ink-2",
        )} title={modeTitle}>
          {modeLabel}
        </span>
        <Link href={`/race/${t.raceId}`} className="font-mono truncate leading-tight flex flex-col">
          <span className="text-accent-cyan">
            {t.trackCode ?? t.raceId} {t.raceNumber ? `R${t.raceNumber}` : ""}
          </span>
          {t.trackName && t.trackName !== t.trackCode && (
            <span className="text-[10px] text-ink-2 normal-case truncate" title={t.trackName}>
              {t.trackName}
            </span>
          )}
        </Link>
        <span className="font-mono text-[11px] text-ink-2 truncate">
          {t.strategyId ?? "manual"}
        </span>
        <span className="truncate">
          <span className="chip border border-line mr-2">{t.type}</span>
          #{t.selections.join("-")}
          {t.horseName && <span className="text-ink-1 ml-2">{t.horseName}</span>}
        </span>
        <span className="font-mono tabular-nums text-right">${t.stake.toFixed(0)}</span>
        <span className="font-mono tabular-nums text-right text-xs"
          title={isPlaceShow ? placeOddsTitle : "Odds we booked at → final tote odds"}>
          {isPlaceShow ? (
            placePrice != null
              ? <span className="text-ink-0">{decimalToFractional(placePrice)}</span>
              : <span className="text-ink-2">—</span>
          ) : (
            <>
              <span className="text-ink-1">{bookedOdds}</span>
              {finalOdds && (
                <>
                  <span className="text-ink-2 mx-1">→</span>
                  <span className="text-ink-0">{finalOdds}</span>
                </>
              )}
            </>
          )}
        </span>
        <span className="text-right text-xs flex flex-col items-end leading-tight">
          {showClosingEV ? (
            <>
              <span className={clsx("font-mono tabular-nums font-semibold",
                effectiveClosingEV! >= 0 ? "text-accent-overlay" : "text-accent-steam")}
                title={t.type === "PLACE"
                  ? "Closing PLACE EV — Dr.Z Ziemba/Hausch formula re-run against the closing PLACE-pool composition (snapshotted pre-off)."
                  : "Closing EV at our captured price — scaled from fire-time EV by the odds drift. Constant-trueP assumption: same horse, same model probability, just rescaled payout."}>
                {effectiveClosingEV! >= 0 ? "+" : ""}{effectiveClosingEV!.toFixed(1)}%
                <EVExplainer
                  context="history"
                  capturedEv={t.capturedEV}
                  closingEv={effectiveClosingEV}
                />
              </span>
              <span className="font-mono tabular-nums text-[10px] text-ink-2"
                title="EV captured at fire moment — what made the strategy fire">
                was {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
              </span>
            </>
          ) : (
            <span className={clsx("font-mono tabular-nums",
              t.capturedEV > 0 ? "text-accent-overlay" : "text-accent-steam")}
              title={t.type === "WIN" || t.type === "PLACE"
                ? "EV captured at fire moment · closing EV pending (race not settled, or pool-pricing bet without a per-runner closing snapshot)"
                : `EV captured at fire moment · closing EV not tracked for ${t.type}`}>
              {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
              <EVExplainer
                context="history"
                capturedEv={t.capturedEV}
              />
            </span>
          )}
        </span>
        <span className="text-right">
          {!settled ? (
            <span className="chip border border-line text-ink-2">{t.status}</span>
          ) : (
            <div className="flex flex-col items-end">
              <span className={clsx("chip border", t.status === "won"
                ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay"
                : "border-accent-steam/40 bg-accent-steam/10 text-accent-steam")}>
                {t.status}
              </span>
              <span className={clsx("font-mono tabular-nums text-xs mt-0.5",
                pl >= 0 ? "text-accent-overlay" : "text-accent-steam")} title={plTitle}>
                {measureOnly ? "~" : ""}{pl >= 0 ? "+" : ""}${pl.toFixed(2)}
              </span>
              {clv != null && (
                <span className={clsx("font-mono tabular-nums text-[10px]",
                  clv >= 0 ? "text-accent-overlay/70" : "text-accent-steam/70")}>
                  CLV {clv >= 0 ? "+" : ""}{clv.toFixed(1)}%
                </span>
              )}
            </div>
          )}
        </span>
      </div>
      {t.reason && (
        <div className="hidden sm:block mt-0.5 sm:ml-[250px] text-[11px] text-ink-2 italic">
          {t.reason}
          {t.stagedEV != null && Math.abs(t.stagedEV - t.capturedEV) > 1 && (
            <div className="mt-0.5">staged at {t.stagedEV >= 0 ? "+" : ""}{t.stagedEV.toFixed(1)}% EV — price moved before fire</div>
          )}
        </div>
      )}
      {settled && finishOrder.length > 0 && (
        <div className="mt-0.5 sm:ml-[250px] text-[11px] font-mono text-ink-2 flex flex-wrap items-baseline gap-x-2">
          {t.legs?.length ? (
            <>
              <span className="uppercase tracking-wider">legs:</span>
              {t.legs.map((leg, i) => {
                const winner = finishOrder[i];
                const hit = winner != null && leg.selections.includes(winner);
                return (
                  <span key={i} className="whitespace-nowrap">
                    <span className="text-ink-2">R{leg.raceNumber}</span>
                    <span className="text-ink-2 mx-1">→</span>
                    <span className={clsx("font-semibold",
                      hit ? "text-accent-overlay" : "text-accent-steam")}>
                      #{winner ?? "?"}
                    </span>
                    <span className={clsx("ml-1", hit ? "text-accent-overlay" : "text-accent-steam")}>
                      {hit ? "✓" : "✗"}
                    </span>
                    <span className="text-ink-2/70 ml-1">(of {leg.selections.join("-")})</span>
                    {i < t.legs!.length - 1 && <span className="text-ink-2/40 ml-2">·</span>}
                  </span>
                );
              })}
            </>
          ) : (
            <>
              <span className="uppercase tracking-wider">finish:</span>
              {finishOrder.map((p, i) => {
                // Highlight every runner we picked, not just selections[0].
                // Won ticket → green. Lost: yellow when the pick landed in the
                // exact slot we bet it for (selection order = finish order),
                // red when it hit the board in the wrong slot. Picks that
                // finished off the board simply never appear here.
                const selIdx = t.selections.indexOf(p);
                return (
                  <span key={i} className={clsx(
                    selIdx >= 0
                      ? clsx("font-semibold",
                          t.status === "won" ? "text-accent-overlay"
                          : selIdx === i ? "text-accent-warn"
                          : "text-accent-steam")
                      : "text-ink-1",
                  )}>
                    {i + 1}. #{p}
                  </span>
                );
              })}
              {t.selections.length === 1 && (myFinishLabel
                ? <span className="text-ink-2">· pick #{myPick} → {myFinishLabel}</span>
                : (myPick && <span className="text-ink-2">· pick #{myPick} off board</span>))}
            </>
          )}
          <VerifyLinksInline ticket={t} settled={settled} />
        </div>
      )}
      {!settled && finishOrder.length === 0 && <VerifyLinks ticket={t} />}
    </div>
  );
}

// For settled/void tickets, only the result chart matters — pre-race booking
// and live-simulcast links are dead weight. For open/staged tickets we still
// show the full set (the user might actually book or watch).
function relevantVerifyLinks(t: Ticket, settled: boolean) {
  const source = sourceFromRaceId(t.raceId);
  const all = verificationLinks({
    source,
    trackCode: t.trackCode ?? "",
    trackName: t.trackName,
    raceNumber: t.raceNumber ?? 0,
    postTime: t.postTime ?? t.placedAt,
  });
  if (!settled) return all;
  return all.filter(l => l.label.endsWith("Result"));
}

function VerifyLinksInline({ ticket: t, settled }: { ticket: Ticket; settled: boolean }) {
  const links = relevantVerifyLinks(t, settled);
  if (!links.length) return null;
  return (
    <>
      <span className="text-ink-2/60">·</span>
      {links.map(l => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
           title={l.description}
           className="text-accent-cyan/80 hover:text-accent-cyan hover:underline font-mono">
          {l.label} ↗
        </a>
      ))}
    </>
  );
}

function VerifyLinks({ ticket: t }: { ticket: Ticket }) {
  // Void/scratched tickets: race didn't run, so keep it minimal. If a result
  // link exists it's still the best place to confirm the scratch.
  const links = relevantVerifyLinks(t, true);
  if (!links.length) return null;
  return (
    <div className="mt-0.5 sm:ml-[250px] text-[10px] flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-ink-2 font-mono uppercase tracking-wider">verify:</span>
      {links.map(l => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
           title={l.description}
           className="text-accent-cyan/80 hover:text-accent-cyan hover:underline font-mono">
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}
