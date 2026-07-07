"use client";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import clsx from "clsx";

interface StrategyAnalytics {
  id: string;
  bets: number;
  settled: number;
  open: number;
  won: number;
  lost: number;
  staked: number;
  realizedPL: number;
  capturedEVTotal: number;
  hitRate: number | null;
  roi: number | null;
  avgClv: number | null;
  roiCI95Low: number | null;
  roiCI95High: number | null;
  significant: boolean;
  confidenceLabel: "too-small" | "noise" | "edge" | "loss";
  predictedPL: number;
  calibrationRatio: number | null;
}

interface DailyPL {
  day: string;
  strategyId: string;
  bets: number;
  pl: number;
  cumPL: number;
}

interface TrackPerf {
  trackCode: string;
  trackName: string;
  bets: number;
  won: number;
  hitRate: number | null;
  roi: number | null;
  realizedPL: number;
}

interface ConsensusTier {
  tier: number;
  bets: number;
  settled: number;
  won: number;
  staked: number;
  realizedPL: number;
  hitRate: number | null;
  roi: number | null;
  avgClv: number | null;
}

interface PairConsensus {
  strategies: string[];
  bets: number;
  settled: number;
  won: number;
  staked: number;
  realizedPL: number;
  hitRate: number | null;
  roi: number | null;
  avgClv: number | null;
}

interface Stats {
  totals: {
    bets: number; settled: number; won: number; staked: number;
    realizedPL: number; hitRate: number | null; roi: number | null;
    firstBetAt: number | null; lastBetAt: number | null;
  };
  strategies: StrategyAnalytics[];
  dailyPL: DailyPL[];
  tracks: TrackPerf[];
  consensusTiers: ConsensusTier[];
  pairConsensus: PairConsensus[];
  lookbackDays: number;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(apiUrl(`/api/stats?days=${days}`));
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const j = await r.json();
        if (!cancelled) { setData(j); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const i = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [days]);

  if (error && !data) return (
    <div className="py-6 space-y-2">
      <div className="text-accent-steam font-semibold">Couldn&apos;t load analytics</div>
      <div className="text-ink-2 text-sm font-mono">{error}</div>
      <div className="text-ink-2 text-xs">Check that the dev server is running and <code className="text-accent-cyan">/api/stats</code> responds.</div>
    </div>
  );
  if (!data) return <div className="py-6 text-ink-2">Loading analytics…</div>;

  const t = data.totals;
  const dataDays = t.firstBetAt && t.lastBetAt
    ? Math.max(0, (t.lastBetAt - t.firstBetAt) / 86_400_000)
    : 0;

  const sorted = [...data.strategies].sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity));
  const working = sorted.filter(s => s.confidenceLabel === "edge");
  const losing = sorted.filter(s => s.confidenceLabel === "loss");
  const undecided = sorted.filter(s => s.confidenceLabel === "noise" || s.confidenceLabel === "too-small");

  return (
    <div className="py-6 space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold">Analytics</h1>
          <p className="stat-label">Strategy verdicts, consensus, carryover watch, cumulative P/L.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-2 font-mono uppercase tracking-wider">window:</span>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={clsx("px-2 py-1 rounded border font-mono",
                d === days
                  ? "bg-accent-cyan/15 border-accent-cyan/50 text-accent-cyan"
                  : "border-line text-ink-2 hover:text-ink-1")}>
              {d}d
            </button>
          ))}
        </div>
      </header>

      <HeadlineStrip t={t} dataDays={dataDays}/>

      <StrategyGroup
        kind="working"
        title="Working"
        subtitle="Profitable with statistical confidence. Keep running."
        empty="No strategy has cleared the bar yet. Needs ≥30 settled bets and a 95% CI entirely above zero."
        strategies={working}
      />

      <StrategyGroup
        kind="losing"
        title="Losing"
        subtitle="Losing money with confidence. Turn these off."
        empty="No proven losers — yet."
        strategies={losing}
      />

      <StrategyGroup
        kind="undecided"
        title="Not enough data"
        subtitle="Could go either way. Let them run more before judging."
        empty="Every strategy has a verdict."
        strategies={undecided}
      />

      <ConsensusSection
        tiers={data.consensusTiers}
        pairs={data.pairConsensus}
      />

      <CarryoverWatch/>

      <SupportingData
        daily={data.dailyPL}
        tracks={data.tracks}
        lookbackDays={data.lookbackDays}
      />
    </div>
  );
}

function ConsensusSection({ tiers, pairs }: { tiers: ConsensusTier[]; pairs: PairConsensus[] }) {
  if (tiers.length === 0) {
    return null;
  }
  const tiersSorted = [...tiers].sort((a, b) => a.tier - b.tier);
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2 text-accent-cyan">
          <span className="text-lg">⌒</span>
          Cross-strategy agreement
          <span className="text-ink-2 text-xs font-mono">does consensus beat solo?</span>
        </h2>
      </div>
      <p className="stat-label mb-3">
        Tickets bucketed by how many strategies independently picked the same horse.
        If 2-strategy or 3-strategy ROI consistently beats 1-strategy ROI, agreement is a real signal.
      </p>

      <div className="panel overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-2">
              <th className="px-3 py-2 stat-label">agreement</th>
              <th className="px-3 py-2 stat-label text-right">tickets</th>
              <th className="px-3 py-2 stat-label text-right">settled</th>
              <th className="px-3 py-2 stat-label text-right">hit%</th>
              <th className="px-3 py-2 stat-label text-right">avg CLV</th>
              <th className="px-3 py-2 stat-label text-right">ROI</th>
              <th className="px-3 py-2 stat-label text-right">real P/L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/30">
            {tiersSorted.map(row => (
              <tr key={row.tier}>
                <td className="px-3 py-2">
                  <span className={clsx("chip border font-mono text-[10px]",
                    row.tier === 1 ? "border-ink-2/30 text-ink-2" :
                    row.tier === 2 ? "border-accent-cyan/40 text-accent-cyan bg-accent-cyan/10" :
                                     "border-accent-overlay/40 text-accent-overlay bg-accent-overlay/10")}>
                    {row.tier === 1 ? "SOLO" : `${row.tier} STRATEGIES AGREE`}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.bets}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.settled}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {row.hitRate == null ? "—" : `${(row.hitRate * 100).toFixed(0)}%`}
                </td>
                <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
                  row.avgClv == null ? "text-ink-2" : row.avgClv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                  {row.avgClv == null ? "—" : `${row.avgClv >= 0 ? "+" : ""}${(row.avgClv * 100).toFixed(1)}%`}
                </td>
                <td className={clsx("px-3 py-2 text-right font-mono tabular-nums font-semibold",
                  row.roi == null ? "text-ink-2" : row.roi >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                  {row.roi == null ? "—" : `${row.roi >= 0 ? "+" : ""}${(row.roi * 100).toFixed(1)}%`}
                </td>
                <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
                  row.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                  {row.realizedPL >= 0 ? "+" : ""}${row.realizedPL.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pairs.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mb-2">By exact strategy combination</h3>
          <p className="stat-label mb-3">
            Which specific groups of strategies, when they agree, produce the best (and worst) bets.
          </p>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-2">
                  <th className="px-3 py-2 stat-label">strategies agreeing</th>
                  <th className="px-3 py-2 stat-label text-right">tickets</th>
                  <th className="px-3 py-2 stat-label text-right">hit%</th>
                  <th className="px-3 py-2 stat-label text-right">avg CLV</th>
                  <th className="px-3 py-2 stat-label text-right">ROI</th>
                  <th className="px-3 py-2 stat-label text-right">P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {pairs.sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity)).map(p => (
                  <tr key={p.strategies.join("+")}>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.strategies.map(s => (
                          <span key={s} className="chip border border-line text-[10px] font-mono">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{p.bets}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {p.hitRate == null ? "—" : `${(p.hitRate * 100).toFixed(0)}%`}
                    </td>
                    <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
                      p.avgClv == null ? "text-ink-2" : p.avgClv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                      {p.avgClv == null ? "—" : `${p.avgClv >= 0 ? "+" : ""}${(p.avgClv * 100).toFixed(1)}%`}
                    </td>
                    <td className={clsx("px-3 py-2 text-right font-mono tabular-nums font-semibold",
                      p.roi == null ? "text-ink-2" : p.roi >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                      {p.roi == null ? "—" : `${p.roi >= 0 ? "+" : ""}${(p.roi * 100).toFixed(1)}%`}
                    </td>
                    <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
                      p.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                      {p.realizedPL >= 0 ? "+" : ""}${p.realizedPL.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[11px] text-ink-2 mt-3 italic">
        Note: agreement isn&apos;t true independent cross-validation since the strategies share the same input data (TVG odds + morning line).
        A real test of independence would require a strategy built on different data (e.g. PP-based pace ratings).
      </p>
    </section>
  );
}

function HeadlineStrip({ t, dataDays }: { t: Stats["totals"]; dataDays: number }) {
  const plClass = t.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam";
  const roiClass = t.roi == null ? "text-ink-0" : t.roi >= 0 ? "text-accent-overlay" : "text-accent-steam";
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-y border-line/40 py-3 text-sm">
      <span className="text-ink-2">Overall:</span>
      <span>
        <span className={clsx("font-mono tabular-nums font-semibold text-base", plClass)}>
          {t.realizedPL >= 0 ? "+" : ""}${t.realizedPL.toFixed(0)}
        </span>
        <span className="text-ink-2 text-xs ml-1">P/L</span>
      </span>
      <span>
        <span className={clsx("font-mono tabular-nums font-semibold text-base", roiClass)}>
          {t.roi == null ? "—" : `${t.roi >= 0 ? "+" : ""}${(t.roi * 100).toFixed(1)}%`}
        </span>
        <span className="text-ink-2 text-xs ml-1">ROI</span>
      </span>
      <span className="text-ink-1">
        <span className="font-mono tabular-nums">{t.settled.toLocaleString()}</span>
        <span className="text-ink-2 text-xs ml-1">settled bets</span>
      </span>
      <span className="text-ink-1">
        <span className="font-mono tabular-nums">{t.hitRate == null ? "—" : `${(t.hitRate * 100).toFixed(0)}%`}</span>
        <span className="text-ink-2 text-xs ml-1">hit rate</span>
      </span>
      <span className="text-ink-2 text-xs ml-auto">
        {dataDays.toFixed(1)} days of data
      </span>
    </div>
  );
}

const GROUP_STYLE: Record<"working" | "losing" | "undecided", { mark: string; markCls: string; titleCls: string }> = {
  working:   { mark: "✓", markCls: "text-accent-overlay", titleCls: "text-accent-overlay" },
  losing:    { mark: "✗", markCls: "text-accent-steam",   titleCls: "text-accent-steam" },
  undecided: { mark: "?", markCls: "text-ink-2",          titleCls: "text-ink-1" },
};

function StrategyGroup({
  kind, title, subtitle, empty, strategies,
}: {
  kind: "working" | "losing" | "undecided";
  title: string;
  subtitle: string;
  empty: string;
  strategies: StrategyAnalytics[];
}) {
  const g = GROUP_STYLE[kind];
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className={clsx("text-base font-semibold flex items-center gap-2", g.titleCls)}>
          <span className={clsx("text-lg", g.markCls)}>{g.mark}</span>
          {title}
          <span className="text-ink-2 text-xs font-mono">({strategies.length})</span>
        </h2>
        <p className="stat-label">{subtitle}</p>
      </div>
      {strategies.length === 0 ? (
        <div className="panel p-4 text-ink-2 text-sm">{empty}</div>
      ) : (
        <div className="space-y-2">
          {strategies.map(s => <StrategyCard key={s.id} s={s} kind={kind}/>)}
        </div>
      )}
    </section>
  );
}

function StrategyCard({ s, kind }: { s: StrategyAnalytics; kind: "working" | "losing" | "undecided" }) {
  const roiCls = s.roi == null ? "text-ink-2" : s.roi >= 0 ? "text-accent-overlay" : "text-accent-steam";
  const plCls = s.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam";
  const clvCls = s.avgClv == null ? "text-ink-2" : s.avgClv >= 0 ? "text-accent-overlay" : "text-accent-steam";
  const borderCls =
    kind === "working" ? "border-l-2 border-l-accent-overlay/60" :
    kind === "losing"  ? "border-l-2 border-l-accent-steam/60" :
                         "border-l-2 border-l-ink-2/30";

  return (
    <div className={clsx("panel p-4 flex flex-wrap items-center gap-x-6 gap-y-3", borderCls)}>
      <div className="flex-1 min-w-[180px]">
        <div className="font-mono text-base text-ink-0">{s.id}</div>
        <div className="text-xs text-ink-2 mt-0.5">
          {s.settled} settled{s.open > 0 ? ` · ${s.open} open` : ""} · hit{" "}
          {s.hitRate == null ? "—" : `${(s.hitRate * 100).toFixed(0)}%`}
          {s.avgClv != null && (
            <> · CLV <span className={clvCls}>{s.avgClv >= 0 ? "+" : ""}{(s.avgClv * 100).toFixed(1)}%</span></>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className={clsx("text-2xl font-mono font-semibold tabular-nums", roiCls)}>
          {s.roi == null ? "—" : `${s.roi >= 0 ? "+" : ""}${(s.roi * 100).toFixed(1)}%`}
        </div>
        <div className="text-[11px] text-ink-2">
          ROI
          {s.roiCI95Low != null && s.roiCI95High != null && (
            <> <span className="font-mono">[{(s.roiCI95Low * 100).toFixed(0)}, {(s.roiCI95High * 100).toFixed(0)}]</span></>
          )}
        </div>
      </div>

      <div className="text-right border-l border-line/40 pl-6">
        <div className={clsx("text-xl font-mono font-semibold tabular-nums", plCls)}>
          {s.realizedPL >= 0 ? "+" : ""}${s.realizedPL.toFixed(0)}
        </div>
        <div className="text-[11px] text-ink-2">realized</div>
      </div>
    </div>
  );
}

interface CarryoverPick {
  program: string;
  name: string;
  evPercent: number;
  fractionalOdds: string;
  truePWin?: number;
}
interface CarryoverLeg {
  raceNumber: number;
  postTime: number;
  modelQuality: "high" | "medium" | "low";
  picks: CarryoverPick[];
  missing?: boolean;
}
interface CarryoverOpportunity {
  trackCode: string;
  trackName: string;
  startRaceNumber: number;
  postTime: number;
  wagerType: string;
  wagerLabel: string;
  poolAmount: number;
  baseline: number;
  excess: number;
  confidence: "high" | "medium" | "low";
  takeoutAssumption: number;
  rawEdgePct: number;
  legs: CarryoverLeg[];
}

function CarryoverWatch() {
  const [data, setData] = useState<{ opportunities: CarryoverOpportunity[]; note: string } | null>(null);
  useEffect(() => {
    const load = () => fetch(apiUrl("/api/carryovers")).then(r => r.json()).then(setData);
    load();
    const i = setInterval(load, 20_000);
    return () => clearInterval(i);
  }, []);

  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2 text-accent-warn">
          <span className="text-lg">💎</span>
          Carryover watch
          <span className="text-ink-2 text-xs font-mono">free-money exotic pools</span>
        </h2>
      </div>
      <p className="stat-label mb-3">
        Multi-leg exotic pools (Pick 3/4/5/6) with anomalously large size — likely contain carryover from prior days.
        Carryover money is &quot;free&quot; pool you can bet into, mathematically the most reliable +EV in tote betting.
        Only wagers your ADW actually offers will appear here.
      </p>

      {!data ? (
        <div className="panel p-4 text-ink-2 text-sm">Scanning pools…</div>
      ) : data.opportunities.length === 0 ? (
        <div className="panel p-4 text-ink-2 text-sm">
          No anomalous exotic pools detected right now. Big US carryovers usually appear weekend afternoons or after Pick 6 misses on Saturdays.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-2">
                <th className="px-3 py-2 stat-label">track</th>
                <th className="px-3 py-2 stat-label">wager</th>
                <th className="px-3 py-2 stat-label text-right">pool</th>
                <th className="px-3 py-2 stat-label text-right">excess vs baseline</th>
                <th className="px-3 py-2 stat-label text-right">est edge</th>
                <th className="px-3 py-2 stat-label">verify</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30">
              {data.opportunities.map(c => (
                <tr key={`${c.trackCode}-${c.wagerType}`} className={clsx(
                  c.confidence === "high" ? "bg-accent-warn/[0.08]" : "",
                )}>
                  <td className="px-3 py-2">
                    <div className="font-mono text-ink-2 text-xs">{c.trackCode}</div>
                    <div className="text-ink-1">{c.trackName}</div>
                    <div className="text-[10px] text-ink-2">R{c.startRaceNumber} · post {new Date(c.postTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="chip border border-accent-warn/40 bg-accent-warn/10 text-accent-warn font-mono text-[10px]">
                      {c.wagerLabel}
                    </span>
                    {c.legs?.length > 0 && (
                      <div className="mt-2 space-y-0.5 font-mono text-[11px]" title="Top-2 EV picks per leg. ★ marks legs with a strong overlay (EV ≥ +10%) — good single candidate.">
                        {c.legs.map((leg, i) => {
                          const top = leg.picks[0];
                          const isStrongOverlay = !!top && top.evPercent >= 10;
                          return (
                            <div key={i} className="flex items-baseline gap-1.5 whitespace-nowrap">
                              <span className="text-ink-2 w-7">L{i + 1}:</span>
                              {leg.missing ? (
                                <span className="text-ink-2 italic">tba</span>
                              ) : leg.picks.length === 0 ? (
                                <span className="text-ink-2 italic">none</span>
                              ) : (
                                <>
                                  {leg.picks.map((p, j) => (
                                    <span
                                      key={p.program}
                                      className={clsx(
                                        "tabular-nums",
                                        j === 0 && isStrongOverlay ? "text-accent-overlay font-semibold" :
                                        j === 0                    ? "text-ink-1 font-semibold" :
                                                                     "text-ink-2",
                                      )}
                                      title={`${p.name} ${p.fractionalOdds} · EV ${p.evPercent >= 0 ? "+" : ""}${p.evPercent.toFixed(1)}%`}
                                    >
                                      #{p.program}{j === 0 && isStrongOverlay ? "★" : ""}
                                    </span>
                                  ))}
                                  {leg.modelQuality === "low" && <span className="text-ink-2 italic">·low-conf</span>}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    ${Math.round(c.poolAmount).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-accent-warn">
                    +${Math.round(c.excess).toLocaleString()}
                    <div className="text-[10px] text-ink-2">vs ${Math.round(c.baseline).toLocaleString()}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    <span className={clsx("font-semibold",
                      c.confidence === "high" ? "text-accent-overlay" :
                      c.confidence === "medium" ? "text-accent-cyan" : "text-ink-1")}>
                      ~+{c.rawEdgePct.toFixed(0)}%
                    </span>
                    <div className="text-[10px] text-ink-2">{c.confidence} conf</div>
                  </td>
                  <td className="px-3 py-2">
                    <a href={`https://www.equibase.com/profiles/Results.cfm?type=Track&trk=${c.trackCode}&cy=USA`}
                       target="_blank" rel="noreferrer"
                       className="text-accent-cyan hover:underline text-xs font-mono">
                      Equibase ↗
                    </a>
                    <span className="text-ink-2 mx-1">·</span>
                    <a href="https://racing.fanduel.com/#/schedule" target="_blank" rel="noreferrer"
                       className="text-accent-cyan hover:underline text-xs font-mono">
                      FanDuel ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-2 mt-2 italic">
        {data?.note ?? "Heuristic detection — verify on the actual ADW before betting."}
      </p>
    </section>
  );
}

function SupportingData({
  daily, tracks, lookbackDays,
}: {
  daily: DailyPL[];
  tracks: TrackPerf[];
  lookbackDays: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-t border-line/40 pt-4">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-ink-1 hover:text-ink-0 text-sm">
        <span className="font-mono text-accent-cyan">{open ? "▾" : "▸"}</span>
        <span className="font-semibold">Cumulative P/L & per-track</span>
        <span className="text-ink-2 text-xs">— chart, track breakdown, raw export</span>
      </button>

      {open && (
        <div className="mt-4 space-y-6">
          <div>
            <div className="stat-label mb-2">P/L over time ({lookbackDays}d)</div>
            <CumulativePLChart daily={daily}/>
          </div>

          <div>
            <div className="stat-label mb-2">Per-track performance</div>
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-2">
                    <th className="px-3 py-2 stat-label">track</th>
                    <th className="px-3 py-2 stat-label text-right">bets</th>
                    <th className="px-3 py-2 stat-label text-right">hit%</th>
                    <th className="px-3 py-2 stat-label text-right">ROI</th>
                    <th className="px-3 py-2 stat-label text-right">P/L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/30">
                  {tracks.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 text-ink-2 text-center text-xs">
                      No settled bets yet.
                    </td></tr>
                  )}
                  {tracks.map(tr => (
                    <tr key={tr.trackCode}>
                      <td className="px-3 py-2">
                        <span className="font-mono text-ink-2 text-xs">{tr.trackCode}</span>
                        <span className="ml-2 text-ink-1">{tr.trackName}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{tr.bets}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {tr.hitRate == null ? "—" : `${(tr.hitRate * 100).toFixed(0)}%`}
                      </td>
                      <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
                        tr.roi == null ? "text-ink-2" : tr.roi >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                        {tr.roi == null ? "—" : `${tr.roi >= 0 ? "+" : ""}${(tr.roi * 100).toFixed(1)}%`}
                      </td>
                      <td className={clsx("px-3 py-2 text-right font-mono tabular-nums",
                        tr.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                        {tr.realizedPL >= 0 ? "+" : ""}${tr.realizedPL.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-xs text-ink-2 flex flex-wrap items-center gap-3">
            <a href="/api/debug/export-tickets" className="font-mono text-accent-cyan hover:underline">
              Download tickets CSV ↗
            </a>
            <span>·</span>
            <span className="font-mono">
              run <code className="text-accent-cyan">npx tsx scripts/analyze.ts</code> for full CLI report
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

const PALETTE = [
  "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#84cc16", "#3b82f6", "#f97316",
];

function CumulativePLChart({ daily }: { daily: DailyPL[] }) {
  if (daily.length === 0) {
    return (
      <div className="panel p-8 text-center text-ink-2 text-sm">
        Not enough settled data yet. Come back after some races have run.
      </div>
    );
  }
  const byStrat = new Map<string, DailyPL[]>();
  for (const d of daily) {
    let arr = byStrat.get(d.strategyId);
    if (!arr) { arr = []; byStrat.set(d.strategyId, arr); }
    arr.push(d);
  }
  const days = Array.from(new Set(daily.map(d => d.day))).sort();
  const strats = Array.from(byStrat.keys()).sort();
  let yMin = 0, yMax = 0;
  for (const arr of byStrat.values()) {
    for (const p of arr) {
      if (p.cumPL < yMin) yMin = p.cumPL;
      if (p.cumPL > yMax) yMax = p.cumPL;
    }
  }
  const hasMovement = yMin !== 0 || yMax !== 0;
  const range = Math.max(1, yMax - yMin);
  yMin -= range * 0.1;
  yMax += range * 0.1;

  const W = 800, H = 240, padL = 50, padR = 160, padT = 10, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xOf = (day: string) => {
    const i = days.indexOf(day);
    return padL + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  };
  const yOf = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const labels = strats
    .map((sid, i) => {
      const last = byStrat.get(sid)?.slice(-1)[0];
      if (!last) return null;
      return {
        sid,
        color: PALETTE[i % PALETTE.length],
        x: xOf(last.day),
        y: yOf(last.cumPL),
        pl: last.cumPL,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const MIN_GAP = 13;
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  const labelY = new Map<string, number>();
  let prevY = -Infinity;
  for (const l of sorted) {
    const y = Math.max(l.y, prevY + MIN_GAP);
    labelY.set(l.sid, y);
    prevY = y;
  }

  return (
    <div className="panel p-4 overflow-x-auto relative">
      {!hasMovement && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-ink-2 text-xs font-mono bg-bg-1/80 px-3 py-1.5 rounded border border-line">
            no realized P/L yet — all strategies flat at $0
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 700 }}>
        <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)}
          stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3"/>
        <text x={padL - 6} y={yOf(0) + 4} textAnchor="end"
          fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">$0</text>
        {hasMovement && (
          <>
            <text x={padL - 6} y={yOf(yMax) + 4} textAnchor="end"
              fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">${yMax.toFixed(0)}</text>
            <text x={padL - 6} y={yOf(yMin) + 4} textAnchor="end"
              fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">${yMin.toFixed(0)}</text>
          </>
        )}
        {[0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => (
          <text key={i} x={xOf(days[i])} y={H - 6} textAnchor="middle"
            fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">
            {days[i]?.slice(5)}
          </text>
        ))}
        {strats.map((sid, i) => {
          const pts = (byStrat.get(sid) ?? []).map(d => `${xOf(d.day)},${yOf(d.cumPL)}`).join(" ");
          const color = PALETTE[i % PALETTE.length];
          const last = byStrat.get(sid)?.slice(-1)[0];
          if (!last) return <polyline key={sid} points={pts} fill="none" stroke={color} strokeWidth={2}/>;
          const ly = labelY.get(sid) ?? yOf(last.cumPL);
          const lx = W - padR + 8;
          const dx = xOf(last.day);
          const dy = yOf(last.cumPL);
          return (
            <g key={sid}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2}/>
              <circle cx={dx} cy={dy} r={3} fill={color}/>
              {Math.abs(ly - dy) > 2 && (
                <line x1={dx} y1={dy} x2={lx - 2} y2={ly - 3}
                  stroke={color} strokeOpacity={0.35} strokeWidth={1}/>
              )}
              <text x={lx} y={ly} fill={color} fontSize={10} fontFamily="monospace">
                {sid}
                <tspan fill="rgba(255,255,255,0.45)" dx={4}>${last.cumPL.toFixed(0)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
