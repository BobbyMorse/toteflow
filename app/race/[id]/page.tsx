"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useToteflow } from "@/lib/store";
import Countdown from "@/components/Countdown";
import RunnerTable from "@/components/RunnerTable";
import SharpMoneyMeter from "@/components/SharpMoneyMeter";
import OverlayHeatmap from "@/components/OverlayHeatmap";
import FinalFlash from "@/components/FinalFlash";
import PoolFlow from "@/components/PoolFlow";
import TicketBuilder from "@/components/TicketBuilder";
import { PhaseChip } from "@/components/RaceRowItem";
import { fmtMoney, phaseOf } from "@/lib/format";
import Link from "next/link";
import clsx from "clsx";
import type { Race } from "@/lib/types";
import { apiUrl } from "@/lib/api-url";
import { trackTypeBadge } from "@/lib/track-types";

export default function RaceRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const liveRace = useToteflow(s => s.races.find(r => r.id === id));
  const allRaces = useToteflow(s => s.races);
  const [fallback, setFallback] = useState<Race | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "notfound">("idle");

  useEffect(() => {
    if (liveRace || fallback) return;
    setLoadState("loading");
    fetch(apiUrl(`/api/races/${id}`))
      .then(r => r.json())
      .then(j => {
        if (j.race) { setFallback(j.race); setLoadState("idle"); }
        else { setLoadState("notfound"); }
      })
      .catch(() => setLoadState("notfound"));
  }, [liveRace, fallback, id]);

  const race = liveRace ?? fallback;

  const queue = useMemo(() => {
    const now = Date.now();
    return allRaces.filter(r => r.id !== id && r.postTime - now > 0).slice(0, 5);
  }, [allRaces, id]);

  if (!race) {
    if (loadState === "notfound") {
      return (
        <div className="py-16 text-center space-y-3">
          <div className="text-ink-0 text-lg font-semibold">Race {id} not available</div>
          <div className="text-ink-2 text-sm">It may have already finished or been removed from the schedule.</div>
          <Link className="btn-primary inline-block" href="/">← Back to Race Radar</Link>
        </div>
      );
    }
    return <div className="py-16 text-center text-ink-2">Loading race {id}…</div>;
  }

  const ms = race.postTime - Date.now();
  const phase = ms <= 0 ? "off" : phaseOf(ms);
  const chaos = phase === "chaos";
  const fieldSize = race.runners.filter(r => !r.scratched).length;
  const badge = trackTypeBadge(race.trackType);
  const badgeTone =
    badge.tone === "tb"      ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay" :
    badge.tone === "harness" ? "border-accent-warn/40 bg-accent-warn/10 text-accent-warn" :
    badge.tone === "qh"      ? "border-accent-info/40 bg-accent-info/10 text-accent-info" :
    badge.tone === "intl"    ? "border-line text-ink-2" :
                               "border-accent-steam/40 bg-accent-steam/10 text-accent-steam";

  return (
    <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink-0 font-mono uppercase tracking-wider">← Race Radar</Link>

      <header className={clsx(
        "relative panel p-3 sm:p-6 overflow-hidden",
        chaos && "border-accent-steam/60 ring-1 ring-accent-steam/40 animate-chaos-pulse",
      )}>
        <div className={clsx("absolute inset-0 grid-bg opacity-30 pointer-events-none")}/>
        <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 sm:gap-4 items-start md:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
              <div className="px-2 sm:px-2.5 py-1 rounded bg-bg-3 font-mono text-xs sm:text-sm">{race.trackCode}</div>
              <h1 className="text-xl sm:text-3xl font-display font-semibold break-words">{race.track} · R{race.raceNumber}</h1>
              <PhaseChip phase={phase} />
              <span className={clsx("chip border", badgeTone)} title={race.trackType ?? "unclassified"}>{badge.label}</span>
              <span className="chip border border-line text-ink-2" title="Field size (non-scratched)">{fieldSize} runners</span>
              <span className="chip border border-line text-ink-2">{race.source}</span>
              {race.modelQuality && (
                <span
                  className={clsx("chip border",
                    race.modelQuality === "high"
                      ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay"
                      : race.modelQuality === "medium"
                      ? "border-accent-warn/40 bg-accent-warn/10 text-accent-warn"
                      : "border-accent-steam/40 bg-accent-steam/10 text-accent-steam",
                  )}
                  title={race.modelQualityReason}
                >model: {race.modelQuality}</span>
              )}
            </div>
            <div className="text-ink-1 text-xs sm:text-sm">{race.distance} · {race.surface} · {race.conditions} {race.purse ? `· $${race.purse.toLocaleString()}` : ""}</div>
            <div className="mt-3 grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-1 text-[11px] sm:text-xs text-ink-2 font-mono">
              <span>Win Pool: <span className="text-ink-0">{fmtMoney(race.winPoolTotal)}</span></span>
              <span>Exacta: <span className="text-ink-0">{fmtMoney(race.exactaPoolTotal)}</span></span>
              <span>Trifecta: <span className="text-ink-0">{fmtMoney(race.trifectaPoolTotal)}</span></span>
              <span>Takeout: <span className="text-ink-0">{(race.takeout*100).toFixed(1)}%</span></span>
            </div>
          </div>
          <div className="text-left md:text-right">
            <Countdown postTime={race.postTime} size={chaos ? "xl" : "lg"} />
            <div className="stat-label mt-1 sm:mt-2">Post {new Date(race.postTime).toLocaleTimeString([], { hour12: false })}</div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <div className="space-y-4">
          <RunnerTable race={race}/>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OverlayHeatmap runners={race.runners}/>
            <FinalFlash runners={race.runners}/>
          </div>
        </div>
        <div className="space-y-4">
          <SharpMoneyMeter runners={race.runners}/>
          <PoolFlow race={race}/>
          <TicketBuilder race={race}/>
          {queue.length > 0 && (
            <div className="panel p-4">
              <h3 className="text-sm font-semibold mb-3">Next Up</h3>
              <ul className="space-y-1.5">
                {queue.map(q => (
                  <li key={q.id}>
                    <Link href={`/race/${q.id}`} className="flex items-center justify-between text-sm hover:text-ink-0 text-ink-1">
                      <span>{q.trackCode} R{q.raceNumber}</span>
                      <Countdown postTime={q.postTime} size="sm" showLabel={false}/>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
