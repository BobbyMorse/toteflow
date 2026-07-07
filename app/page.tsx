"use client";
import { useMemo } from "react";
import { useToteflow } from "@/lib/store";
import RaceRowItem from "@/components/RaceRowItem";
import { fmtCountdown, phaseOf } from "@/lib/format";

export default function RaceRadar() {
  const races = useToteflow(s => s.races);
  const alerts = useToteflow(s => s.alerts);

  const groups = useMemo(() => {
    const now = Date.now();
    const chaos = races.filter(r => (r.postTime - now) > 0 && (r.postTime - now) <= 60_000);
    const action = races.filter(r => (r.postTime - now) > 60_000 && (r.postTime - now) <= 5*60_000);
    const discovery = races.filter(r => (r.postTime - now) > 5*60_000 && (r.postTime - now) <= 15*60_000);
    const scheduled = races.filter(r => (r.postTime - now) > 15*60_000);
    return { chaos, action, discovery, scheduled };
  }, [races]);

  const stats = useMemo(() => {
    const live = races.filter(r => r.postTime - Date.now() > 0);
    const topEV = races.flatMap(r => r.runners.map(rn => ({ r, rn }))).reduce(
      (a, b) => (b.rn.evPercent > (a?.rn.evPercent ?? -Infinity) ? b : a), null as any);
    const hottest = races.flatMap(r => r.runners.map(rn => ({ r, rn }))).reduce(
      (a, b) => (b.rn.steamScore > (a?.rn.steamScore ?? -Infinity) ? b : a), null as any);
    return { liveCount: live.length, topEV, hottest };
  }, [races]);

  return (
    <div className="py-6">
      <header className="flex flex-col gap-4 mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-display font-semibold">Race Radar</h1>
          <span className="stat-label">Live tote intelligence · {stats.liveCount} races queued</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Top Overlay" value={stats.topEV ? `+${stats.topEV.rn.evPercent.toFixed(0)}%` : "—"}
            sub={stats.topEV ? `${stats.topEV.r.trackCode} R${stats.topEV.r.raceNumber} · #${stats.topEV.rn.program}` : ""} accent="text-accent-overlay"/>
          <Stat label="Steam Leader" value={stats.hottest ? `${Math.round(stats.hottest.rn.steamScore)}/100` : "—"}
            sub={stats.hottest ? `${stats.hottest.r.trackCode} R${stats.hottest.r.raceNumber} · #${stats.hottest.rn.program}` : ""} accent="text-accent-steam"/>
          <Stat label="Alerts (5m)" value={alerts.length.toString()} sub="real-time"/>
          <Stat label="Active Tracks" value={new Set(races.map(r => r.trackCode)).size.toString()} sub="across feeds"/>
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
    <div className="panel p-3">
      <div className="stat-label">{label}</div>
      <div className={`mt-1 text-2xl font-display font-semibold ${accent}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-2 font-mono mt-0.5">{sub}</div>}
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
