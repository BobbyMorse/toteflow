"use client";
import Link from "next/link";
import type { Race } from "@/lib/types";
import Countdown from "./Countdown";
import { trackTypeBadge } from "@/lib/track-types";
import clsx from "clsx";

export default function RaceRowItem({ race }: { race: Race }) {
  const live = race.runners.filter(r => !r.scratched);
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
        "grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(220px,1.4fr)_minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1 items-center px-3 py-2.5 rounded-md",
        "bg-bg-1/60 hover:bg-bg-2 transition-colors border border-line/40 hover:border-line",
        race.phase === "chaos" && "ring-1 ring-accent-steam/50 animate-chaos-pulse",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 shrink-0 rounded bg-bg-3 flex items-center justify-center text-[11px] font-mono">
          {race.trackCode}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-0 leading-tight truncate">{race.track}</div>
          <div className="text-[10px] text-ink-2 font-mono uppercase tracking-wider truncate">R{race.raceNumber} · {race.distance} · {live.length}h</div>
        </div>
      </div>
      <div className="flex sm:hidden items-center gap-2 justify-end">
        <Countdown postTime={race.postTime} size="md" />
        <StatusOrPhaseChip race={race} />
      </div>
      <div className="col-span-2 sm:col-span-1 flex items-center gap-2 text-xs text-ink-1 min-w-0">
        <span
          className={clsx("chip border shrink-0 text-[10px] px-1.5 py-0.5", badgeTone)}
          title={race.trackType ?? "unclassified"}
        >{badge.label}</span>
        <span className="truncate">{race.conditions}</span>
      </div>
      <div className="hidden sm:block">
        <Countdown postTime={race.postTime} size="md" />
      </div>
      <div className="hidden sm:block text-right">
        <StatusOrPhaseChip race={race} />
      </div>
    </Link>
  );
}

// Prefer the live TVG status when the race is at/past scheduled post — that's
// when the distinction matters. In drag (IC after scheduled post) we want a
// clear "still bettable" signal so a manual bettor knows they can still get
// the ticket in. SK means pool is closed. Before scheduled post we fall back
// to the phase chip since the countdown carries the same information.
export function StatusOrPhaseChip({ race }: { race: Race }) {
  const ms = race.postTime - Date.now();
  const inDrag = ms <= 0 && race.statusCode === "IC";
  const raceOff = race.statusCode === "SK";
  if (inDrag) {
    return (
      <span
        className="chip border border-accent-warn/60 bg-accent-warn/15 text-accent-warn animate-pulse"
        title="Race is dragging — scheduled post passed but pool is still open (TVG status: Up Next)"
      >DRAG · {Math.floor(-ms / 1000)}s</span>
    );
  }
  if (raceOff) {
    return (
      <span
        className="chip border border-line text-ink-2"
        title="Race is off — pool closed (TVG status: Race Off)"
      >OFF</span>
    );
  }
  return <PhaseChip phase={race.phase} />;
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
