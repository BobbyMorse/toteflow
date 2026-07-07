"use client";
import Link from "next/link";
import type { Race } from "@/lib/types";
import Countdown from "./Countdown";
import { evColor } from "@/lib/format";
import { trackTypeBadge } from "@/lib/track-types";
import clsx from "clsx";

export default function RaceRowItem({ race }: { race: Race }) {
  const live = race.runners.filter(r => !r.scratched);
  const bestOverlay = live.reduce((a, b) => (b.evPercent > a.evPercent ? b : a), live[0]);
  const steamLead = live.reduce((a, b) => (b.steamScore > a.steamScore ? b : a), live[0]);
  const badge = trackTypeBadge(race.trackType);
  const badgeTone =
    badge.tone === "tb"      ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay" :
    badge.tone === "harness" ? "border-accent-warn/40 bg-accent-warn/10 text-accent-warn" :
    badge.tone === "qh"      ? "border-accent-info/40 bg-accent-info/10 text-accent-info" :
    badge.tone === "intl"    ? "border-line text-ink-2" :
                               "border-accent-steam/40 bg-accent-steam/10 text-accent-steam";
  return (
    <Link
      href={`/race/${race.id}`}
      className={clsx(
        "grid grid-cols-[120px_1fr_120px_1fr_1fr_80px] gap-3 items-center px-3 py-2.5 rounded-md",
        "bg-bg-1/60 hover:bg-bg-2 transition-colors border border-line/40 hover:border-line",
        race.phase === "chaos" && "ring-1 ring-accent-steam/50 animate-chaos-pulse",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded bg-bg-3 flex items-center justify-center text-[11px] font-mono">
          {race.trackCode}
        </div>
        <div>
          <div className="text-sm font-semibold text-ink-0 leading-tight">{race.track}</div>
          <div className="text-[10px] text-ink-2 font-mono uppercase tracking-wider">R{race.raceNumber} · {race.distance} · {live.length}h</div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-1 truncate">
        <span
          className={clsx("chip border shrink-0 text-[10px] px-1.5 py-0.5", badgeTone)}
          title={race.trackType ?? "unclassified"}
        >{badge.label}</span>
        <span className="truncate">{race.conditions}</span>
      </div>
      <div>
        <Countdown postTime={race.postTime} size="md" />
      </div>
      <div className="flex flex-col">
        <div className="stat-label">Sharp money</div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 bg-bg-3 rounded">
            <div
              className={clsx("h-full rounded",
                steamLead?.steamScore >= 80 ? "bg-accent-steam" :
                steamLead?.steamScore >= 60 ? "bg-accent-warn" : "bg-accent-info"
              )}
              style={{ width: `${Math.max(4, steamLead?.steamScore ?? 0)}%` }}
            />
          </div>
          <div className="text-xs font-mono tabular-nums text-ink-1 w-12 text-right">
            #{steamLead?.program ?? "-"} · {Math.round(steamLead?.steamScore ?? 0)}
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="stat-label flex items-center gap-1.5">
          <span>Top overlay</span>
          {race.modelQuality && race.modelQuality !== "high" && (
            <span
              className={clsx("inline-block w-1.5 h-1.5 rounded-full",
                race.modelQuality === "low" ? "bg-accent-steam" : "bg-accent-warn")}
              title={`Model: ${race.modelQuality} — ${race.modelQualityReason ?? ""}`}
            />
          )}
        </div>
        <div className="flex items-baseline gap-2">
          {race.modelQuality === "low" ? (
            <>
              <span className="font-mono tabular-nums text-sm text-ink-2" title="Model unreliable on this market">—</span>
              <span className="text-xs text-ink-2">model n/a</span>
            </>
          ) : (
            <>
              <span className={clsx("font-mono tabular-nums text-sm", evColor(bestOverlay?.evPercent ?? 0))}>
                {bestOverlay?.evPercent > 0 ? "+" : ""}{bestOverlay?.evPercent.toFixed(0) ?? 0}% EV
              </span>
              <span className="text-xs text-ink-1">
                #{bestOverlay?.program} · {bestOverlay?.fractionalOdds}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right">
        <PhaseChip phase={race.phase} />
      </div>
    </Link>
  );
}

export function PhaseChip({ phase }: { phase: Race["phase"] }) {
  const map: Record<string, string> = {
    scheduled: "text-ink-2 border-line",
    discovery: "text-accent-info border-accent-info/40 bg-accent-info/10",
    action:    "text-accent-warn border-accent-warn/40 bg-accent-warn/10",
    chaos:     "text-accent-steam border-accent-steam/40 bg-accent-steam/10 animate-pulse",
    off:       "text-ink-2 border-line",
    official:  "text-accent-overlay border-accent-overlay/40 bg-accent-overlay/10",
  };
  return (
    <span className={clsx("chip border", map[phase])}>{phase}</span>
  );
}
