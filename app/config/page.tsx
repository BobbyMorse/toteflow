"use client";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import type { AutobookState, StratStats } from "@/lib/autobook-view";
import clsx from "clsx";

export default function ConfigPage() {
  const [state, setState] = useState<AutobookState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDisabled, setShowDisabled] = useState(false);

  useEffect(() => {
    const load = async () => {
      const ab = await fetch(apiUrl("/api/autobook")).then(r => r.json());
      setState(ab);
      setLoading(false);
    };
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  async function patchStrategy(id: string, patch: Partial<StratStats["config"]>) {
    await fetch(apiUrl("/api/autobook"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy: { id, ...patch } }),
    });
    setState(s => s ? {
      ...s,
      strategies: s.strategies.map(st =>
        st.id === id ? { ...st, config: { ...st.config, ...patch } } : st,
      ),
    } : s);
  }

  return (
    <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-baseline gap-2 sm:gap-3">
        <h1 className="text-xl sm:text-2xl font-display font-semibold">Configuration</h1>
        <span className="stat-label">Per-strategy tuning and P/L attribution.</span>
      </header>

      {loading && <div className="text-ink-2">Loading…</div>}

      {state && <PLContribution strategies={state.strategies} />}

      {state && (
        <section className="panel overflow-hidden">
          <div className="px-5 py-3 border-b border-line/40 flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold">Strategy Leaderboard</h2>
              <span className="stat-label">sorted by ROI · P/L is the verdict, CLV is just a leading indicator</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
              <input type="checkbox" checked={showDisabled}
                onChange={e => setShowDisabled(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent-cyan" />
              show disabled
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-2">
                  <th className="px-3 py-2 stat-label">on</th>
                  <th className="px-3 py-2 stat-label">strategy</th>
                  <th className="px-3 py-2 stat-label text-right">ev≥</th>
                  <th className="px-3 py-2 stat-label text-right">stake</th>
                  <th className="px-3 py-2 stat-label">phase</th>
                  <th className="px-3 py-2 stat-label text-right">bets</th>
                  <th className="px-3 py-2 stat-label text-right">hit%</th>
                  <th className="px-3 py-2 stat-label text-right">avg clv</th>
                  <th className="px-3 py-2 stat-label text-right" title="Mean model EV at race-off — captured EV stops being honest once odds drift">avg close EV</th>
                  <th className="px-3 py-2 stat-label text-right">roi</th>
                  <th className="px-3 py-2 stat-label text-right">p/l</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {sortStrategies(state.strategies, showDisabled).map(s => (
                  <StrategyRow key={s.id} s={s} onPatch={p => patchStrategy(s.id, p)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// Effective ROI/volume for sort + visibility: measure-only strategies carry
// their record in the shadow slice (real stats are zero by design), so read
// from there for them.
function effRoi(s: StratStats): number | null {
  return s.measureOnly ? (s.shadow?.roi ?? null) : s.roi;
}
function effTotal(s: StratStats): number {
  return s.measureOnly ? (s.shadow?.total ?? 0) : s.total;
}

function sortStrategies(strategies: StratStats[], showDisabled: boolean): StratStats[] {
  const filtered = showDisabled
    ? strategies
    // Keep a strategy when it's enabled OR has a track record. Measure-only
    // strategies always have total 0 (every bet is a $0 shadow), so check their
    // shadow volume too — otherwise disabling one makes it vanish entirely.
    : strategies.filter(s => s.config.enabled || effTotal(s) > 0);
  return [...filtered].sort((a, b) => {
    const ar = effRoi(a) ?? -Infinity;
    const br = effRoi(b) ?? -Infinity;
    if (ar !== br) return br - ar;
    return effTotal(b) - effTotal(a);
  });
}

function PLContribution({ strategies }: { strategies: StratStats[] }) {
  const active = strategies.filter(s => s.total > 0);
  if (active.length === 0) return null;
  const totalAbsPL = active.reduce((a, s) => a + Math.abs(s.realizedPL), 0);
  if (totalAbsPL === 0) return null;
  const sorted = [...active].sort((a, b) => Math.abs(b.realizedPL) - Math.abs(a.realizedPL));
  const netPL = active.reduce((a, s) => a + s.realizedPL, 0);
  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold">P/L Contribution</h2>
        <span className={clsx("text-sm font-mono tabular-nums",
          netPL >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
          net {netPL >= 0 ? "+" : ""}${netPL.toFixed(2)}
        </span>
      </div>
      <div className="space-y-1.5">
        {sorted.map(s => {
          const pct = (Math.abs(s.realizedPL) / totalAbsPL) * 100;
          const isWin = s.realizedPL >= 0;
          return (
            <div key={s.id} className="grid grid-cols-[minmax(0,90px)_1fr_minmax(0,110px)] sm:grid-cols-[160px_1fr_110px] items-center gap-2 sm:gap-3 text-xs">
              <span className="font-mono text-ink-1 truncate">{s.id}</span>
              <div className="h-3 bg-bg-2 rounded-sm overflow-hidden relative">
                <div className={clsx("h-full",
                  isWin ? "bg-accent-overlay/70" : "bg-accent-steam/70")}
                  style={{ width: `${pct}%` }} />
              </div>
              <span className={clsx("font-mono tabular-nums text-right",
                isWin ? "text-accent-overlay" : "text-accent-steam")}>
                {isWin ? "+" : ""}${s.realizedPL.toFixed(2)} · {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StrategyRow({ s, onPatch }: { s: StratStats; onPatch: (p: Partial<StratStats["config"]>) => void }) {
  // Measure-only strategies book every bet as a $0 shadow, so their bankroll
  // stats are all zero — show the shadow slice (hypothetical) instead so the row
  // reflects the real record. Marked with ~ / a tooltip; never a bankroll figure.
  const m = s.measureOnly && s.shadow ? s.shadow : null;
  const total = m ? m.total : s.total;
  const hitRate = m ? m.hitRate : s.hitRate;
  const roi = m ? m.roi : s.roi;
  const pl = m ? m.realizedPL : s.realizedPL;
  const clv = m ? m.avgClv : s.avgClv;
  const closeEV = m ? m.avgClosingEV : s.avgClosingEV;
  const rowTint =
    total === 0 ? "" :
    roi == null ? "" :
    roi > 0.05 ? "bg-accent-overlay/[0.06]" :
    roi < -0.05 ? "bg-accent-steam/[0.06]" : "";
  return (
    <tr className={clsx("text-sm", !s.config.enabled && "opacity-50", rowTint)}>
      <td className="px-3 py-2">
        <input type="checkbox" checked={s.config.enabled}
          onChange={e => onPatch({ enabled: e.target.checked })}
          className="w-4 h-4 accent-accent-cyan" />
      </td>
      <td className="px-3 py-2">
        <div className="text-ink-0 font-medium flex items-center gap-2">
          {s.name}
          {m && (
            <span className="chip border border-line/60 bg-bg-1 text-ink-2 text-[10px] normal-case tracking-normal"
              title="Measure-only: books every bet as a $0 shadow — never touches the bankroll. Stats shown are the hypothetical record at its shadow stake.">
              measure-only
            </span>
          )}
        </div>
        <div className="text-[11px] text-ink-2 max-w-md leading-tight">{s.thesis}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <input type="number" min={0} max={50} step={1}
          value={s.config.evThreshold}
          onChange={e => onPatch({ evThreshold: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })}
          className="w-14 px-1 py-0.5 bg-bg-1 border border-line rounded font-mono tabular-nums text-right" />
      </td>
      <td className="px-3 py-2 text-right">
        <input type="number" min={1} max={500} step={1}
          value={s.config.stake}
          onChange={e => onPatch({ stake: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
          className="w-14 px-1 py-0.5 bg-bg-1 border border-line rounded font-mono tabular-nums text-right" />
      </td>
      <td className="px-3 py-2">
        <select value={s.config.fireAtPhase}
          onChange={e => onPatch({ fireAtPhase: e.target.value })}
          className="px-1 py-0.5 bg-bg-1 border border-line rounded font-mono text-xs">
          <option value="discovery">discovery</option>
          <option value="action">action</option>
          <option value="chaos">chaos</option>
        </select>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{total}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {hitRate == null ? <span className="text-ink-2">—</span> : `${(hitRate * 100).toFixed(0)}%`}
      </td>
      <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
        clv == null ? "text-ink-2" : clv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
        {clv == null ? "—" : `${clv >= 0 ? "+" : ""}${clv.toFixed(1)}%`}
      </td>
      <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
        closeEV == null ? "text-ink-2" : closeEV >= 0 ? "text-accent-overlay" : "text-accent-steam")}
        title="Mean model EV at race-off across settled bets — the truthful grading metric">
        {closeEV == null ? "—" : `${closeEV >= 0 ? "+" : ""}${closeEV.toFixed(1)}%`}
      </td>
      <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
        roi == null ? "text-ink-2" : roi >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
        {roi == null ? "—" : `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`}
      </td>
      <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
        pl >= 0 ? "text-accent-overlay" : "text-accent-steam")}
        title={m ? "Hypothetical P/L at the shadow stake — measure-only, never part of the bankroll" : undefined}>
        {m ? "~" : ""}{pl >= 0 ? "+" : ""}${pl.toFixed(2)}
      </td>
    </tr>
  );
}
