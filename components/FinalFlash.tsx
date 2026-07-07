"use client";
import type { Runner } from "@/lib/types";
import { fractionalOdds } from "@/lib/format";
import clsx from "clsx";

export default function FinalFlash({ runners }: { runners: Runner[] }) {
  const live = runners.filter(r => !r.scratched);
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-0">Final-Flash Predictor</h3>
        <span className="stat-label">Now → Post</span>
      </div>
      <div className="space-y-1.5">
        {live.map(r => {
          const proj = r.projectedFinalOdds ?? r.currentOdds;
          const delta = proj - r.currentOdds;
          return (
            <div key={r.program} className="grid grid-cols-[28px_1fr_auto_auto] gap-3 items-center text-sm">
              <span className="w-7 h-7 rounded text-xs font-mono flex items-center justify-center"
                style={{ background: r.silkColor ?? "#19202d", color: "white" }}>{r.program}</span>
              <span className="text-ink-0 truncate">{r.name}</span>
              <span className="font-mono tabular-nums text-ink-1">{r.fractionalOdds}</span>
              <span className={clsx("font-mono tabular-nums",
                delta < -0.2 ? "text-accent-overlay" : delta > 0.2 ? "text-accent-steam" : "text-ink-1")}>
                → {fractionalOdds(proj)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
