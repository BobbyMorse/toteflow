"use client";
import { motion } from "framer-motion";
import type { Race } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

export default function PoolFlow({ race }: { race: Race }) {
  const pools = [
    { label: "Win", v: race.winPoolTotal, c: "#22d3ee" },
    { label: "Exacta", v: race.exactaPoolTotal, c: "#a855f7" },
    { label: "Trifecta", v: race.trifectaPoolTotal, c: "#f59e0b" },
  ];
  const max = Math.max(...pools.map(p => p.v));
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-0">Pool Flow</h3>
        <span className="stat-label">Liquidity</span>
      </div>
      <div className="space-y-3">
        {pools.map(p => (
          <div key={p.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-ink-1">{p.label}</span>
              <span className="font-mono tabular-nums">{fmtMoney(p.v)}</span>
            </div>
            <div className="h-2 rounded bg-bg-3 overflow-hidden">
              <motion.div
                className="h-full"
                style={{ background: p.c }}
                animate={{ width: `${(p.v / max) * 100}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
