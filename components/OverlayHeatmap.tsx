"use client";
import type { Runner } from "@/lib/types";
import clsx from "clsx";

function bg(ev: number): string {
  if (ev > 20) return "bg-emerald-500/80 text-white";
  if (ev > 10) return "bg-emerald-600/60 text-white";
  if (ev > 3)  return "bg-emerald-700/40 text-emerald-100";
  if (ev > -3) return "bg-bg-3 text-ink-1";
  if (ev > -10) return "bg-red-800/40 text-red-100";
  if (ev > -20) return "bg-red-700/60 text-white";
  return "bg-red-600/80 text-white";
}

export default function OverlayHeatmap({ runners }: { runners: Runner[] }) {
  const live = runners.filter(r => !r.scratched);
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-0">Overlay Heatmap</h3>
        <div className="flex items-center gap-2 stat-label">
          <span className="inline-block w-3 h-3 bg-emerald-500/80 rounded-sm" /> Overlay
          <span className="inline-block w-3 h-3 bg-red-600/80 rounded-sm ml-2" /> Overbet
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-1.5">
        {live.map(r => (
          <div key={r.program}
            className={clsx("rounded p-2 text-center border border-line/40", bg(r.evPercent))}
            title={`${r.name} · ${r.fractionalOdds} · EV ${r.evPercent.toFixed(1)}%`}
          >
            <div className="text-[10px] opacity-80">#{r.program}</div>
            <div className="font-mono tabular-nums text-sm leading-tight">
              {r.evPercent > 0 ? "+" : ""}{r.evPercent.toFixed(0)}%
            </div>
            <div className="text-[10px] opacity-90 mt-0.5">{r.fractionalOdds}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
