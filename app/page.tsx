"use client";
import { useEffect, useMemo, useState } from "react";
import { useToteflow } from "@/lib/store";
import RaceRowItem from "@/components/RaceRowItem";
import { apiUrl } from "@/lib/api-url";
import clsx from "clsx";

interface AutobookSummary {
  totals: {
    open: number;
    settled: number;
    total: number;
    realizedPL: number;
    totalStaked: number;
    roi: number | null;
  };
  today: {
    settled: number;
    realizedPL: number;
    totalStaked: number;
    roi: number | null;
  };
  strategies: Array<{ config: { enabled: boolean } }>;
}

export default function RaceRadar() {
  const races = useToteflow(s => s.races);
  const [book, setBook] = useState<AutobookSummary | null>(null);

  useEffect(() => {
    const load = () => fetch(apiUrl(`/api/autobook?tz=${new Date().getTimezoneOffset()}`)).then(r => r.json()).then(setBook).catch(() => {});
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  const groups = useMemo(() => {
    const now = Date.now();
    const chaos = races.filter(r => (r.postTime - now) > 0 && (r.postTime - now) <= 60_000);
    const action = races.filter(r => (r.postTime - now) > 60_000 && (r.postTime - now) <= 5*60_000);
    const discovery = races.filter(r => (r.postTime - now) > 5*60_000 && (r.postTime - now) <= 15*60_000);
    const scheduled = races.filter(r => (r.postTime - now) > 15*60_000);
    return { chaos, action, discovery, scheduled };
  }, [races]);

  const liveCount = useMemo(() => races.filter(r => r.postTime - Date.now() > 0).length, [races]);

  const stats = useMemo(() => {
    if (!book) return null;
    const enabled = book.strategies.filter(s => s.config.enabled).length;
    const roi = book.totals.roi;
    const todayPL = book.today.realizedPL;
    const todayRoi = book.today.roi;
    return {
      roiPct: roi == null ? null : roi * 100,
      settled: book.totals.settled,
      totalTickets: book.totals.total,
      todayPL,
      todayRoiPct: todayRoi == null ? null : todayRoi * 100,
      todaySettled: book.today.settled,
      todayStaked: book.today.totalStaked,
      openCount: book.totals.open,
      strategiesEnabled: enabled,
      strategiesTotal: book.strategies.length,
    };
  }, [book]);

  return (
    <div className="py-4 sm:py-6">
      <header className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-display font-semibold">Race Radar</h1>
          <span className="stat-label">Live tote intelligence · {liveCount} races queued</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <Stat
            label="Overall ROI"
            value={stats?.roiPct == null ? "—" : `${stats.roiPct >= 0 ? "+" : ""}${stats.roiPct.toFixed(1)}%`}
            sub={stats ? `${stats.settled} settled · ${stats.totalTickets} total` : ""}
            accent={stats?.roiPct == null ? "text-ink-2" : stats.roiPct >= 0 ? "text-accent-overlay" : "text-accent-steam"}
          />
          <Stat
            label="Today P/L"
            value={stats == null ? "—" : `${stats.todayPL >= 0 ? "+" : ""}$${stats.todayPL.toFixed(2)}`}
            sub={stats ? `${stats.todaySettled} settled · $${stats.todayStaked.toFixed(0)} staked` : ""}
            accent={stats == null ? "text-ink-2" : stats.todayPL >= 0 ? "text-accent-overlay" : "text-accent-steam"}
          />
          <Stat
            label="Open Tickets"
            value={stats?.openCount?.toString() ?? "—"}
            sub="in flight"
          />
          <Stat
            label="Strategies Live"
            value={stats == null ? "—" : `${stats.strategiesEnabled}/${stats.strategiesTotal}`}
            sub="enabled"
          />
        </div>
      </header>

      <Section title="Chaos · T-60s" tone="chaos" rows={groups.chaos}/>
      <Section title="Action · T-5m" tone="action" rows={groups.action}/>
      <Section title="Discovery · T-15m" tone="discovery" rows={groups.discovery}/>
      <Section title="Scheduled" tone="scheduled" rows={groups.scheduled}/>
    </div>
  );
}

function Stat({ label, value, sub, accent = "text-ink-0" }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="panel p-2.5 sm:p-3">
      <div className="stat-label">{label}</div>
      <div className={clsx("mt-1 text-lg sm:text-2xl font-display font-semibold", accent)}>{value}</div>
      {sub && <div className="text-[10px] sm:text-[11px] text-ink-2 font-mono mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Section({ title, tone, rows }: { title: string; tone: "chaos" | "action" | "discovery" | "scheduled"; rows: any[] }) {
  if (!rows.length) return null;
  const dot = {
    chaos: "bg-accent-steam animate-pulse",
    action: "bg-accent-warn",
    discovery: "bg-accent-info",
    scheduled: "bg-ink-2",
  }[tone];
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <h2 className="text-xs uppercase tracking-[0.18em] font-mono text-ink-1">{title}</h2>
        <div className="flex-1 h-px bg-line ml-2" />
        <span className="stat-label">{rows.length}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map(r => <RaceRowItem key={r.id} race={r}/>)}
      </div>
    </section>
  );
}
