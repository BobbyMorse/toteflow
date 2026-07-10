"use client";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import clsx from "clsx";

interface DailyTotal {
  day: string;
  bets: number;
  settled: number;
  won: number;
  staked: number;
  realizedPL: number;
  hitRate: number | null;
  roi: number | null;
}

interface StatsResponse {
  dailyTotals: DailyTotal[];
  lookbackDays: number;
}

export default function StatsPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(apiUrl(`/api/stats?days=${days}`));
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const j = await r.json();
        if (!cancelled) {
          setData({ dailyTotals: j.dailyTotals ?? [], lookbackDays: j.lookbackDays ?? days });
          setError(null);
        }
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
      <div className="text-accent-steam font-semibold">Couldn&apos;t load results</div>
      <div className="text-ink-2 text-sm font-mono">{error}</div>
    </div>
  );
  if (!data) return <div className="py-6 text-ink-2">Loading results…</div>;

  return (
    <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-semibold">Results</h1>
          <p className="stat-label">Day-by-day P/L. Click a day to see every bet placed.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
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

      <DailyResults
        daily={data.dailyTotals}
        lookbackDays={data.lookbackDays}
      />

      <div className="border-t border-line/40 pt-4 text-xs text-ink-2">
        Strategy verdicts, cumulative P/L, per-track breakdown, and carryover watch moved to{" "}
        <a href="/analytics" className="text-accent-cyan hover:underline font-mono">Analytics ↗</a>.
      </div>
    </div>
  );
}

function DailyResults({
  daily, lookbackDays,
}: {
  daily: DailyTotal[];
  lookbackDays: number;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "bars">("calendar");

  // Fill in days with no bets so the calendar shows a continuous window.
  const window = buildDayWindow(lookbackDays);
  const byDay = new Map(daily.map(d => [d.day, d]));
  const cells: DailyTotal[] = window.map(day =>
    byDay.get(day) ?? {
      day, bets: 0, settled: 0, won: 0, staked: 0,
      realizedPL: 0, hitRate: null, roi: null,
    }
  );

  const activeDays = daily.filter(d => d.bets > 0);
  const totalPL = daily.reduce((s, d) => s + d.realizedPL, 0);
  const bestDay = activeDays.reduce<DailyTotal | null>(
    (b, d) => (b == null || d.realizedPL > b.realizedPL ? d : b), null);
  const worstDay = activeDays.reduce<DailyTotal | null>(
    (b, d) => (b == null || d.realizedPL < b.realizedPL ? d : b), null);
  const winningDays = activeDays.filter(d => d.realizedPL > 0).length;
  const losingDays = activeDays.filter(d => d.realizedPL < 0).length;

  const selected = selectedDay ? byDay.get(selectedDay) ?? null : null;

  const totalCls = totalPL >= 0 ? "text-accent-overlay" : "text-accent-steam";

  return (
    <section>
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <div className="flex flex-wrap items-baseline gap-x-3 sm:gap-x-4 gap-y-1 text-[11px] sm:text-xs text-ink-2 w-full sm:w-auto">
          <span><span className="font-mono tabular-nums text-ink-1">{activeDays.length}</span> active days</span>
          <span className="text-line">·</span>
          <span>
            window{" "}
            <span className={clsx("font-mono tabular-nums font-semibold", totalCls)}>
              {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(0)}
            </span>
          </span>
          <span className="text-line">·</span>
          <span>
            <span className="font-mono tabular-nums text-accent-overlay">{winningDays}W</span>
            {" / "}
            <span className="font-mono tabular-nums text-accent-steam">{losingDays}L</span>
          </span>
          {bestDay && (
            <>
              <span className="text-line">·</span>
              <span>
                best <span className="font-mono tabular-nums text-accent-overlay">+${bestDay.realizedPL.toFixed(0)}</span>
              </span>
            </>
          )}
          {worstDay && worstDay.realizedPL < 0 && (
            <>
              <span className="text-line">·</span>
              <span>
                worst <span className="font-mono tabular-nums text-accent-steam">${worstDay.realizedPL.toFixed(0)}</span>
              </span>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs">
          {(["calendar", "bars"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={clsx("px-2 py-1 rounded border font-mono",
                v === view
                  ? "bg-accent-cyan/15 border-accent-cyan/50 text-accent-cyan"
                  : "border-line text-ink-2 hover:text-ink-1")}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "calendar" ? (
        <CalendarGrid
          cells={cells}
          selectedDay={selectedDay}
          onSelect={d => setSelectedDay(sel => sel === d ? null : d)}
        />
      ) : (
        <DailyPLBars
          cells={cells}
          selectedDay={selectedDay}
          onSelect={d => setSelectedDay(sel => sel === d ? null : d)}
        />
      )}

      {selected && (
        <DayDetail
          day={selected}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {!selected && activeDays.length > 0 && (
        <p className="stat-label mt-2">Click a day to see every bet placed.</p>
      )}
    </section>
  );
}

// Returns YYYY-MM-DD strings for the last N days, oldest first, using local time
// so the calendar aligns with the user's day boundaries.
function buildDayWindow(lookbackDays: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = lookbackDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(fmtLocalDay(d));
  }
  return out;
}

function fmtLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse YYYY-MM-DD as a local date (avoids the UTC-shift you get from `new Date(str)`).
function parseDayLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function colorForPL(pl: number, maxAbs: number): string {
  if (pl === 0 || maxAbs === 0) return "rgba(255,255,255,0.05)";
  const intensity = Math.min(1, Math.abs(pl) / maxAbs);
  const alpha = 0.15 + intensity * 0.65;
  return pl > 0
    ? `rgba(16,185,129,${alpha.toFixed(3)})`
    : `rgba(239,68,68,${alpha.toFixed(3)})`;
}

function CalendarGrid({
  cells, selectedDay, onSelect,
}: {
  cells: DailyTotal[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  if (cells.length === 0) {
    return <div className="panel p-4 text-ink-2 text-sm">No bets in the current window.</div>;
  }
  const maxAbs = Math.max(1, ...cells.map(c => Math.abs(c.realizedPL)));

  const first = parseDayLocal(cells[0].day);
  const last  = parseDayLocal(cells[cells.length - 1].day);
  const leadPad = first.getDay();
  const tailPad = 6 - last.getDay();
  const padded: (DailyTotal | null)[] = [
    ...Array<null>(leadPad).fill(null),
    ...cells,
    ...Array<null>(tailPad).fill(null),
  ];

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
  const today = fmtLocalDay(new Date());

  return (
    <div className="panel p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {DOW.map((d, i) => (
          <div key={d} className="text-[10px] text-ink-2 font-mono uppercase tracking-wider pb-1 text-center">
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{DOW_SHORT[i]}</span>
          </div>
        ))}
        {padded.map((cell, i) => {
          if (!cell) {
            return <div key={`p${i}`} className="aspect-square sm:aspect-[7/5]" />;
          }
          const d = parseDayLocal(cell.day);
          const dayNum = d.getDate();
          const isFirstOfMonth = dayNum === 1;
          const monthLabel = isFirstOfMonth
            ? d.toLocaleString(undefined, { month: "short" })
            : null;
          const isToday = cell.day === today;
          const isSelected = selectedDay === cell.day;
          const hasBets = cell.bets > 0;
          const bg = hasBets ? colorForPL(cell.realizedPL, maxAbs) : "transparent";
          const plCls = cell.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam";
          const plCompact = Math.abs(cell.realizedPL) >= 1000
            ? `${(cell.realizedPL / 1000).toFixed(1)}k`
            : cell.realizedPL.toFixed(0);

          return (
            <button
              key={cell.day}
              onClick={() => hasBets && onSelect(cell.day)}
              disabled={!hasBets}
              title={hasBets
                ? `${cell.day} · ${cell.bets} bets · ${cell.realizedPL >= 0 ? "+" : ""}$${cell.realizedPL.toFixed(0)}`
                : `${cell.day} — no bets`}
              style={{ background: bg }}
              className={clsx(
                "aspect-square sm:aspect-[7/5] rounded-md p-1 sm:p-2 flex flex-col justify-between text-left border transition",
                "min-h-[44px] sm:min-h-[54px] overflow-hidden",
                isSelected
                  ? "border-accent-cyan ring-1 ring-accent-cyan/40"
                  : hasBets
                    ? "border-white/10 hover:border-white/30"
                    : "border-white/5",
                !hasBets && "cursor-default opacity-60",
              )}
            >
              <div className="flex items-baseline justify-between gap-0.5">
                <span className={clsx(
                  "font-mono text-[10px] sm:text-[11px] tabular-nums leading-none",
                  isToday ? "text-accent-cyan font-semibold" : "text-ink-2",
                )}>
                  {monthLabel ? (
                    <>
                      <span className="hidden sm:inline">{monthLabel} </span>
                      {dayNum}
                    </>
                  ) : dayNum}
                </span>
                {hasBets && (
                  <span className="font-mono text-[9px] text-ink-2 tabular-nums leading-none hidden sm:inline">
                    {cell.bets}b
                  </span>
                )}
              </div>
              {hasBets ? (
                <div className={clsx("font-mono tabular-nums font-semibold text-right leading-none", plCls)}>
                  <span className="text-[10px] sm:text-sm">
                    {cell.realizedPL >= 0 ? "+" : ""}${plCompact}
                  </span>
                </div>
              ) : (
                <div className="text-[9px] text-ink-2/60 font-mono text-right leading-none">—</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 text-[10px] text-ink-2 font-mono">
        <span>loss</span>
        <div className="w-3 h-3 rounded-[2px]" style={{ background: "rgba(239,68,68,0.75)" }}/>
        <div className="w-3 h-3 rounded-[2px]" style={{ background: "rgba(239,68,68,0.35)" }}/>
        <div className="w-3 h-3 rounded-[2px] border border-white/10"/>
        <div className="w-3 h-3 rounded-[2px]" style={{ background: "rgba(16,185,129,0.35)" }}/>
        <div className="w-3 h-3 rounded-[2px]" style={{ background: "rgba(16,185,129,0.75)" }}/>
        <span>profit</span>
      </div>
    </div>
  );
}

function DailyPLBars({
  cells, selectedDay, onSelect,
}: {
  cells: DailyTotal[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  const maxAbs = Math.max(1, ...cells.map(c => Math.abs(c.realizedPL)));
  const W = 800, H = 200, padL = 44, padR = 8, padT = 10, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const zeroY = padT + innerH / 2;
  const barW = Math.max(2, innerW / Math.max(1, cells.length) - 1);
  const xOf = (i: number) => padL + (i + 0.5) * (innerW / Math.max(1, cells.length));
  const scale = (innerH / 2) / maxAbs;

  const idxLabels = [0, Math.floor((cells.length - 1) / 2), cells.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i && v >= 0 && v < cells.length);

  return (
    <div className="panel p-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 500 }}>
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY}
          stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3"/>
        <text x={padL - 6} y={zeroY + 4} textAnchor="end"
          fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">$0</text>
        <text x={padL - 6} y={padT + 10} textAnchor="end"
          fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">+${maxAbs.toFixed(0)}</text>
        <text x={padL - 6} y={H - padB - 2} textAnchor="end"
          fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">-${maxAbs.toFixed(0)}</text>

        {cells.map((c, i) => {
          if (c.bets === 0) return null;
          const h = Math.abs(c.realizedPL) * scale;
          const y = c.realizedPL >= 0 ? zeroY - h : zeroY;
          const isSelected = selectedDay === c.day;
          const fill = c.realizedPL >= 0 ? "#10b981" : "#ef4444";
          return (
            <g key={c.day}>
              <rect
                x={xOf(i) - barW / 2}
                y={y}
                width={barW}
                height={Math.max(1, h)}
                fill={fill}
                fillOpacity={isSelected ? 1 : 0.75}
                stroke={isSelected ? "#22d3ee" : "none"}
                strokeWidth={isSelected ? 1.5 : 0}
                onClick={() => onSelect(c.day)}
                style={{ cursor: "pointer" }}
              >
                <title>{`${c.day} · ${c.bets} bets · ${c.realizedPL >= 0 ? "+" : ""}$${c.realizedPL.toFixed(0)}`}</title>
              </rect>
            </g>
          );
        })}

        {idxLabels.map(i => (
          <text key={i} x={xOf(i)} y={H - 6} textAnchor="middle"
            fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">
            {cells[i].day.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

interface DayTicket {
  id: string;
  raceId: string;
  trackCode?: string;
  trackName?: string;
  raceNumber?: number;
  horseName?: string;
  type: string;
  selections: string[];
  stake: number;
  capturedOdds: number;
  capturedEV: number;
  capturedEVRaw?: number;
  closingOdds?: number;
  closingEV?: number;
  placedAt: number;
  status: "open" | "won" | "lost";
  strategyId?: string;
  realizedPL?: number;
}

function DayDetail({ day, onClose }: { day: DailyTotal; onClose: () => void }) {
  const [tickets, setTickets] = useState<DayTicket[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTickets(null);
    setErr(null);
    fetch(apiUrl(`/api/stats/day?date=${day.day}`))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (!cancelled) setTickets(j.tickets); })
      .catch(e => { if (!cancelled) setErr(e.message || String(e)); });
    return () => { cancelled = true; };
  }, [day.day]);

  const d = parseDayLocal(day.day);
  const label = d.toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "short", day: "numeric",
  });
  const plCls = day.realizedPL >= 0 ? "text-accent-overlay" : "text-accent-steam";
  const roiCls = day.roi == null ? "text-ink-2" : day.roi >= 0 ? "text-accent-overlay" : "text-accent-steam";

  const byStrategy = new Map<string, { bets: number; pl: number; won: number; settled: number }>();
  for (const t of tickets ?? []) {
    const key = t.strategyId ?? "manual";
    const row = byStrategy.get(key) ?? { bets: 0, pl: 0, won: 0, settled: 0 };
    row.bets += 1;
    row.pl += t.realizedPL ?? 0;
    if (t.status === "won" || t.status === "lost") row.settled += 1;
    if (t.status === "won") row.won += 1;
    byStrategy.set(key, row);
  }
  const stratRows = Array.from(byStrategy.entries())
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => b.pl - a.pl);

  return (
    <div className="panel p-4 mt-3 border-l-2 border-l-accent-cyan/60">
      <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap mb-3">
        <div className="font-semibold text-ink-0">{label}</div>
        <div className={clsx("font-mono tabular-nums text-lg font-semibold", plCls)}>
          {day.realizedPL >= 0 ? "+" : ""}${day.realizedPL.toFixed(0)}
        </div>
        <div className={clsx("font-mono tabular-nums text-sm", roiCls)}>
          {day.roi == null ? "" : `${day.roi >= 0 ? "+" : ""}${(day.roi * 100).toFixed(1)}% ROI`}
        </div>
        <div className="text-xs text-ink-2 font-mono">
          {day.bets} bets · {day.settled} settled ·{" "}
          {day.hitRate == null ? "—" : `${(day.hitRate * 100).toFixed(0)}%`} hit
        </div>
        <button onClick={onClose}
          className="ml-auto text-xs text-ink-2 hover:text-ink-0 font-mono">
          close ✕
        </button>
      </div>

      {stratRows.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {stratRows.map(r => (
            <span key={r.id} className="chip border border-line/60 bg-bg-1 font-mono text-[11px]">
              <span className="text-ink-1">{r.id}</span>
              <span className="text-ink-2 mx-1">·</span>
              <span className="text-ink-2">{r.bets}b</span>
              <span className="text-ink-2 mx-1">·</span>
              <span className={r.pl >= 0 ? "text-accent-overlay" : "text-accent-steam"}>
                {r.pl >= 0 ? "+" : ""}${r.pl.toFixed(0)}
              </span>
            </span>
          ))}
        </div>
      )}

      {err ? (
        <div className="text-accent-steam text-sm">Couldn&apos;t load: {err}</div>
      ) : !tickets ? (
        <div className="text-ink-2 text-sm">Loading bets…</div>
      ) : tickets.length === 0 ? (
        <div className="text-ink-2 text-sm">No bets recorded for this day.</div>
      ) : (
        <DayTicketsTable tickets={tickets}/>
      )}
    </div>
  );
}

function DayTicketsTable({ tickets }: { tickets: DayTicket[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-ink-2">
            <th className="px-2 py-1.5 stat-label">time</th>
            <th className="px-2 py-1.5 stat-label">race</th>
            <th className="px-2 py-1.5 stat-label">strategy</th>
            <th className="px-2 py-1.5 stat-label">bet</th>
            <th className="px-2 py-1.5 stat-label text-right">stake</th>
            <th className="px-2 py-1.5 stat-label text-right" title="Booked odds → final tote odds. Payout is computed from the final tote price.">odds</th>
            <th className="px-2 py-1.5 stat-label text-right" title="Closing EV (of the bet we locked in) → primary; fire-time captured EV below as reference.">EV</th>
            <th className="px-2 py-1.5 stat-label text-right">result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/20">
          {tickets.map(t => {
            const settled = t.status === "won" || t.status === "lost";
            const pl = t.realizedPL ?? 0;
            // Closing EV — WIN-only, scaled from fire-time EV by odds drift
            // (constant-trueP assumption). Same derivation as the tickets page
            // and lib/storage.deriveClosingEV. PLACE/SHOW/exotic can't be
            // rescaled from closingOdds alone, so we fall back to captured EV.
            // Use strategy-calibrated capturedEV (not capturedEVRaw) so the
            // closing number stays on the same probability model as the "was".
            const derivedClosingEV = t.type === "WIN"
              && t.closingOdds && t.closingOdds > 0
              && t.capturedOdds && t.capturedOdds > 0
              ? (t.capturedEV + 100) * (t.closingOdds / t.capturedOdds) - 100
              : null;
            const effectiveClosingEV = derivedClosingEV ?? t.closingEV ?? null;
            const showClosingEV = t.type === "WIN" && effectiveClosingEV != null;
            return (
              <tr key={t.id}>
                <td className="px-2 py-1.5 font-mono tabular-nums text-ink-2">
                  {new Date(t.placedAt).toLocaleTimeString([], { hour12: false })}
                </td>
                <td className="px-2 py-1.5 font-mono">
                  <span className="text-accent-cyan">{t.trackCode ?? t.raceId}</span>
                  {t.raceNumber ? <span className="text-ink-2"> R{t.raceNumber}</span> : null}
                </td>
                <td className="px-2 py-1.5 font-mono text-ink-2">
                  {t.strategyId ?? "manual"}
                </td>
                <td className="px-2 py-1.5">
                  <span className="chip border border-line text-[10px] font-mono mr-1.5">{t.type}</span>
                  <span className="font-mono text-ink-1">#{t.selections.join("-")}</span>
                  {t.horseName && <span className="text-ink-2 ml-1">{t.horseName}</span>}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  ${t.stake.toFixed(0)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-1"
                    title="Odds we booked at → final tote odds (payout is computed from the final tote price, not the booked price)">
                  {t.capturedOdds > 0 ? t.capturedOdds.toFixed(2) : "—"}
                  {t.closingOdds && t.closingOdds > 0 && (
                    <>
                      <span className="text-ink-2 mx-1">→</span>
                      <span className="text-ink-0">{t.closingOdds.toFixed(2)}</span>
                    </>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <div className="flex flex-col items-end leading-tight">
                    {showClosingEV ? (
                      <>
                        <span className={clsx("font-mono tabular-nums font-semibold",
                          effectiveClosingEV! >= 0 ? "text-accent-overlay" : "text-accent-steam")}
                          title="Closing EV — scaled from fire-time EV by odds drift. This is the EV of the bet we actually locked in.">
                          {effectiveClosingEV! >= 0 ? "+" : ""}{effectiveClosingEV!.toFixed(1)}%
                        </span>
                        <span className="font-mono tabular-nums text-[10px] text-ink-2"
                          title="EV captured at fire moment — what made the strategy fire">
                          was {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
                        </span>
                      </>
                    ) : (
                      <span className={clsx("font-mono tabular-nums",
                        t.capturedEV >= 0 ? "text-accent-overlay" : "text-accent-steam")}
                        title="EV captured at fire moment · closing EV pending or not applicable">
                        {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right">
                  {!settled ? (
                    <span className="chip border border-line text-ink-2 text-[10px]">open</span>
                  ) : (
                    <span className={clsx("font-mono tabular-nums font-semibold",
                      pl >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                      {pl >= 0 ? "+" : ""}${pl.toFixed(2)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
