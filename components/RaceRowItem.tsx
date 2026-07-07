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
        "grid grid-cols-[160px_1fr_140px_90px] gap-3 items-center px-3 py-2.5 rounded-md",
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
