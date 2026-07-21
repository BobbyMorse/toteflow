"use client";
import { use, useEffect, useMemo, useState } from "react";
import type { Ticket } from "@/lib/types";
import { apiUrl } from "@/lib/api-url";
import { isMeasureOnly } from "@/lib/strategies/measure-only";
import { TicketRow } from "@/components/TicketRow";
import Link from "next/link";
import clsx from "clsx";

type StatusFilter = "all" | "settled" | "won" | "lost" | "open";

// P/L attributable to a ticket: measure-only strategies book $0 shadows, so the
// real result lives in shadowPL — mirror the TicketRow logic so the summary and
// the rows agree.
function ticketPL(t: Ticket): number {
  return isMeasureOnly(t.strategyId) ? (t.shadowPL ?? 0) : (t.realizedPL ?? 0);
}
function ticketStake(t: Ticket): number {
  // Measure-only bets never stake real money; use the shadow stake if present
  // so ROI isn't a divide-by-zero. Falls back to the booked stake otherwise.
  return isMeasureOnly(t.strategyId) ? (t.shadowStake ?? t.stake) : t.stake;
}

export default function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const id = decodeURIComponent(rawId);
  const measureOnly = isMeasureOnly(id);

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(apiUrl("/api/tickets"));
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const j = await r.json();
        if (!cancelled) { setTickets(j.tickets ?? []); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const i = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  // All tickets this strategy fired, newest first.
  const mine = useMemo(() => {
    if (!tickets) return [];
    return tickets
      .filter(t => (t.strategyId ?? "manual") === id)
      .sort((a, b) => b.placedAt - a.placedAt);
  }, [tickets, id]);

  const summary = useMemo(() => {
    const settled = mine.filter(t => t.status === "won" || t.status === "lost");
    const won = settled.filter(t => t.status === "won").length;
    const open = mine.filter(t => t.status === "open" || t.status === "staged").length;
    const pl = settled.reduce((a, t) => a + ticketPL(t), 0);
    const staked = settled.reduce((a, t) => a + ticketStake(t), 0);
    return {
      total: mine.length,
      settled: settled.length,
      won,
      open,
      hitRate: settled.length ? won / settled.length : null,
      pl,
      roi: staked > 0 ? pl / staked : null,
    };
  }, [mine]);

  const shown = useMemo(() => {
    switch (filter) {
      case "settled": return mine.filter(t => t.status === "won" || t.status === "lost" || t.status === "void");
      case "won": return mine.filter(t => t.status === "won");
      case "lost": return mine.filter(t => t.status === "lost");
      case "open": return mine.filter(t => t.status === "open" || t.status === "staged");
      default: return mine;
    }
  }, [mine, filter]);

  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: mine.length },
    { key: "settled", label: "Settled", count: mine.filter(t => t.status === "won" || t.status === "lost" || t.status === "void").length },
    { key: "won", label: "Won", count: mine.filter(t => t.status === "won").length },
    { key: "lost", label: "Lost", count: mine.filter(t => t.status === "lost").length },
    { key: "open", label: "Open", count: mine.filter(t => t.status === "open" || t.status === "staged").length },
  ];

  return (
    <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
      <header className="space-y-1">
        <Link href="/analytics" className="text-xs text-accent-cyan hover:underline font-mono">← Analytics</Link>
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-3">
          <h1 className="text-xl sm:text-2xl font-display font-semibold font-mono break-all">{id}</h1>
          {measureOnly && (
            <span className="chip border border-line/60 bg-bg-1 text-ink-2 text-[10px] normal-case tracking-normal"
              title="Measure-only: books every bet as a $0 shadow by design — never touches the bankroll. P/L is the hypothetical record at its shadow stake.">
              measure-only
            </span>
          )}
          <span className="stat-label">Every ticket this strategy has fired · CLV-tracked against TVG closing odds.</span>
        </div>
      </header>

      {error && !tickets && (
        <div className="panel p-4 space-y-1">
          <div className="text-accent-steam font-semibold">Couldn&apos;t load tickets</div>
          <div className="text-ink-2 text-sm font-mono">{error}</div>
        </div>
      )}

      {tickets && (
        <section className="panel p-3 sm:p-5 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-3 sm:gap-6">
          <Stat label="Tickets" value={summary.total.toLocaleString()} />
          <Stat label="Settled" value={summary.settled.toLocaleString()} />
          <Stat label="Won"
            value={`${summary.won} / ${summary.settled}`}
            color={summary.won > 0 ? "text-accent-overlay" : "text-ink-2"} />
          <Stat label="Hit rate"
            value={summary.hitRate == null ? "—" : `${(summary.hitRate * 100).toFixed(0)}%`} />
          <Stat label="Open" value={summary.open.toLocaleString()} />
          <Stat label={measureOnly ? "P/L (shadow)" : "Realized P/L"}
            value={`${measureOnly ? "~" : ""}${summary.pl >= 0 ? "+" : ""}$${summary.pl.toFixed(2)}`}
            color={summary.pl >= 0 ? "text-accent-overlay" : "text-accent-steam"} />
          <Stat label="ROI"
            value={summary.roi == null ? "—" : `${summary.roi >= 0 ? "+" : ""}${(summary.roi * 100).toFixed(1)}%`}
            color={summary.roi == null ? undefined : summary.roi >= 0 ? "text-accent-overlay" : "text-accent-steam"} />
        </section>
      )}

      {tickets && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={clsx("px-2.5 py-1 rounded border font-mono",
                f.key === filter
                  ? "bg-accent-cyan/15 border-accent-cyan/50 text-accent-cyan"
                  : "border-line text-ink-2 hover:text-ink-1")}>
              {f.label} <span className="text-ink-2">({f.count})</span>
            </button>
          ))}
        </div>
      )}

      {!tickets && !error ? (
        <div className="text-ink-2">Loading tickets…</div>
      ) : tickets && mine.length === 0 ? (
        <div className="panel p-10 text-center text-ink-2">
          No tickets found for <span className="font-mono text-ink-1">{id}</span>.
          <div className="mt-3"><Link className="text-accent-cyan hover:underline" href="/analytics">Back to Analytics</Link></div>
        </div>
      ) : tickets && shown.length === 0 ? (
        <div className="panel p-6 text-center text-ink-2 text-sm">No {filter} tickets.</div>
      ) : tickets ? (
        <div className="panel divide-y divide-line/40">
          {shown.map(t => <TicketRow key={t.id} ticket={t} />)}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, color = "text-ink-0" }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-left">
      <div className="stat-label">{label}</div>
      <div className={`font-mono tabular-nums font-semibold text-sm sm:text-base ${color}`}>{value}</div>
    </div>
  );
}
