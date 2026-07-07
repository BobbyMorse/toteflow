"use client";
import { useMemo, useState } from "react";
import type { Race } from "@/lib/types";
import { apiUrl } from "@/lib/api-url";
import clsx from "clsx";

type BetType = "WIN" | "EXACTA" | "TRIFECTA";

export default function TicketBuilder({ race }: { race: Race }) {
  const [type, setType] = useState<BetType>("WIN");
  const [picks, setPicks] = useState<string[]>([]);
  const [stake, setStake] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const requiredCount = type === "WIN" ? 1 : type === "EXACTA" ? 2 : 3;
  const ready = picks.length === requiredCount;

  const live = useMemo(() => race.runners.filter(r => !r.scratched), [race.runners]);

  const projected = useMemo(() => {
    if (!ready) return { payout: 0, ev: 0, decOdds: 0 };
    const map = new Map(live.map(r => [r.program, r]));
    const selected = picks.map(p => map.get(p)!).filter(Boolean);
    let p = 1, dec = 1;
    for (const s of selected) {
      p *= Math.max(0.01, s.winPoolShare);
      dec *= s.currentOdds;
    }
    // Rough exotic-pool fudge: dampens for top-order finishes
    if (type === "EXACTA") dec *= 0.9;
    if (type === "TRIFECTA") dec *= 0.8;
    const payout = stake * dec;
    const ev = (p * dec * (1 - race.takeout) - 1) * 100;
    return { payout, ev, decOdds: dec };
  }, [picks, stake, type, race, live, ready]);

  function toggle(prog: string) {
    setPicks(prev => {
      if (prev.includes(prog)) return prev.filter(p => p !== prog);
      if (prev.length >= requiredCount) return [...prev.slice(1), prog];
      return [...prev, prog];
    });
  }

  async function submit() {
    setSubmitting(true); setMsg(null);
    try {
      const res = await fetch(apiUrl("/api/tickets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceId: race.id,
          type,
          selections: picks,
          stake,
          potentialPayout: projected.payout,
          capturedEV: projected.ev,
          capturedOdds: projected.decOdds,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setMsg(`Ticket placed — ${type} ${picks.join("-")} for $${stake}`);
      setPicks([]);
    } catch (e) { setMsg("Failed to save"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-0">Ticket Builder</h3>
        <div className="flex gap-1">
          {(["WIN","EXACTA","TRIFECTA"] as BetType[]).map(t => (
            <button key={t} onClick={() => { setType(t); setPicks([]); }}
              className={clsx("px-2.5 py-1 rounded text-xs font-mono uppercase tracking-wider",
                type === t ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40" : "bg-bg-2 text-ink-1 border border-line"
              )}>{t}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {live.map(r => {
          const i = picks.indexOf(r.program);
          const order = i + 1;
          const selected = i >= 0;
          return (
            <button key={r.program} onClick={() => toggle(r.program)}
              className={clsx("relative w-10 h-10 rounded font-mono text-sm border transition-colors",
                selected ? "border-accent-cyan/60 ring-2 ring-accent-cyan/40" : "border-line hover:border-ink-2",
              )}
              style={{ background: selected ? r.silkColor : "#10151f", color: "white" }}
              title={`${r.name} · ${r.fractionalOdds}`}>
              {r.program}
              {selected && type !== "WIN" && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] rounded-full bg-accent-cyan text-bg-0 flex items-center justify-center">{order}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="stat-label">Stake</span>
          <div className="flex items-center mt-1">
            <span className="px-2 py-1.5 bg-bg-2 border border-r-0 border-line rounded-l-md text-ink-2">$</span>
            <input
              type="number" min={1} step={1} value={stake}
              onChange={e => setStake(Math.max(1, Number(e.target.value) || 0))}
              className="flex-1 px-2 py-1.5 bg-bg-1 border border-line rounded-r-md font-mono tabular-nums" />
          </div>
        </label>
        <div className="space-y-1">
          <div className="flex justify-between text-xs"><span className="stat-label">Payout</span><span className="font-mono tabular-nums">${projected.payout.toFixed(2)}</span></div>
          <div className="flex justify-between text-xs"><span className="stat-label">EV</span><span className={clsx("font-mono tabular-nums", projected.ev > 0 ? "text-accent-overlay" : "text-accent-steam")}>{projected.ev > 0 ? "+" : ""}{projected.ev.toFixed(1)}%</span></div>
          <div className="flex justify-between text-xs"><span className="stat-label">Eff. odds</span><span className="font-mono tabular-nums">{projected.decOdds.toFixed(2)}x</span></div>
        </div>
      </div>

      <button onClick={submit} disabled={!ready || submitting}
        className={clsx("w-full py-2 rounded-md text-sm font-semibold transition-colors",
          ready
            ? "bg-accent-cyan/20 hover:bg-accent-cyan/30 border border-accent-cyan/50 text-accent-cyan"
            : "bg-bg-2 border border-line text-ink-2 cursor-not-allowed",
        )}>
        {submitting ? "Saving…" : ready ? `Place ${type} — ${picks.join("-")}` : `Pick ${requiredCount - picks.length} more`}
      </button>
      {msg && <div className="text-xs text-ink-1 mt-2">{msg}</div>}
    </div>
  );
}
