"use client";
import type { Runner } from "@/lib/types";
import { steamColor } from "@/lib/format";
import clsx from "clsx";

export default function SharpMoneyMeter({ runners }: { runners: Runner[] }) {
  const sorted = [...runners].filter(r => !r.scratched).sort((a, b) => b.steamScore - a.steamScore).slice(0, 6);
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-0">Sharp Money</h3>
        <span className="stat-label">Velocity · last 60s</span>
      </div>
      <ul className="space-y-2">
        {sorted.map(r => (
          <li key={r.program} className="grid grid-cols-[28px_1fr_auto] gap-3 items-center">
            <span className="w-7 h-7 rounded bg-bg-3 text-xs font-mono flex items-center justify-center" style={{ background: r.silkColor ?? undefined, color: "white" }}>{r.program}</span>
            <div className="min-w-0">
              <div className="text-sm text-ink-0 truncate">{r.name}</div>
              <div className="h-1.5 mt-1 bg-bg-3 rounded overflow-hidden">
                <div className={clsx("h-full", steamColor(r.steamScore))} style={{ width: `${Math.max(2, r.steamScore)}%` }} />
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono tabular-nums text-sm">{r.fractionalOdds}</div>
              <div className="stat-label">{Math.round(r.steamScore)}/100</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
