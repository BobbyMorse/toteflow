"use client";
import type { Race } from "@/lib/types";
import Sparkline from "./Sparkline";
import { evColor } from "@/lib/format";
import clsx from "clsx";
import { motion } from "framer-motion";

export default function RunnerTable({ race }: { race: Race }) {
  const live = race.runners.filter(r => !r.scratched);
  return (
    <div className="panel overflow-x-auto">
      <div className="min-w-[720px]">
      <div className="grid grid-cols-[40px_minmax(160px,1.5fr)_120px_80px_90px_90px_80px_80px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-ink-2 font-mono border-b border-line bg-bg-2/50">
        <div>#</div>
        <div>Horse / Jockey</div>
        <div className="text-right">Odds</div>
        <div className="text-right">Δ</div>
        <div className="text-right">Steam</div>
        <div className="text-right">EV</div>
        <div className="text-right">Pool %</div>
        <div className="text-right">Trend</div>
      </div>
      {live.map(r => {
        const drift = (r.prevOdds ?? r.currentOdds) - r.currentOdds;
        return (
          <motion.div
            key={r.program}
            layout
            animate={{ backgroundColor: ["rgba(34,211,238,0.10)", "rgba(0,0,0,0)"] }}
            transition={{ duration: 0.5 }}
            className="grid grid-cols-[40px_minmax(160px,1.5fr)_120px_80px_90px_90px_80px_80px] gap-2 px-3 py-2 items-center border-b border-line/40 text-sm"
          >
            <div>
              <span className="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-mono"
                style={{ background: r.silkColor ?? "#19202d", color: "white" }}>{r.program}</span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-ink-0">{r.name}</div>
              <div className="text-[11px] text-ink-2 truncate">{r.jockey} · {r.trainer}</div>
            </div>
            <div className="text-right font-mono tabular-nums">{r.fractionalOdds}<span className="text-ink-2"> ({r.currentOdds.toFixed(1)})</span></div>
            <div className={clsx("text-right font-mono tabular-nums",
              drift > 0.1 ? "text-accent-overlay" : drift < -0.1 ? "text-accent-steam" : "text-ink-2")}>
              {drift > 0 ? "▲" : drift < 0 ? "▼" : "·"} {Math.abs(drift).toFixed(2)}
            </div>
            <div className="text-right">
              <div className="inline-block w-16 h-1.5 bg-bg-3 rounded overflow-hidden align-middle">
                <div className={clsx("h-full",
                  r.steamScore >= 80 ? "bg-accent-steam" : r.steamScore >= 60 ? "bg-accent-warn" : "bg-accent-info"
                )} style={{ width: `${Math.max(2, r.steamScore)}%` }} />
              </div>
              <span className="ml-1 font-mono text-xs tabular-nums text-ink-1">{Math.round(r.steamScore)}</span>
            </div>
            <div className={clsx("text-right font-mono tabular-nums",
              race.modelQuality === "low" ? "text-ink-2" : evColor(r.evPercent),
            )} title={race.modelQuality === "low" ? `EV hidden — ${race.modelQualityReason}` : undefined}>
              {race.modelQuality === "low" ? "—" : `${r.evPercent > 0 ? "+" : ""}${r.evPercent.toFixed(1)}%`}
            </div>
            <div className="text-right font-mono tabular-nums text-ink-1">
              {(r.winPoolShare * 100).toFixed(1)}%
            </div>
            <div className="flex justify-end">
              <Sparkline points={r.oddsHistory.slice(-30)} width={70} height={20} />
            </div>
          </motion.div>
        );
      })}
      </div>
    </div>
  );
}
