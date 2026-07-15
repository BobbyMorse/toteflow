"use client";
import { useEffect, useMemo, useState } from "react";
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
  // All-time realized P/L across every settled bet — same number the Tickets
  // page shows, rendered in the header so a month figure can't be misread as
  // contradicting it.
  lifetimePL: number | null;
}

export default function StatsPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Full history in one call (366d covers everything; first bet was
        // 2026-06-30) — month slicing happens client-side, so there is no
        // rolling-window selector to misread.
        const r = await fetch(apiUrl(`/api/stats?days=366&tz=${new Date().getTimezoneOffset()}`));
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const j = await r.json();
        if (!cancelled) {
          setData({
            dailyTotals: j.dailyTotals ?? [],
            lifetimePL: j.totals?.realizedPL ?? null,
          });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const i = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  if (error && !data) return (
    <div className="py-6 space-y-2">
      <div className="text-accent-steam font-semibold">Couldn&apos;t load results</div>
      <div className="text-ink-2 text-sm font-mono">{error}</div>
    </div>
  );
  if (!data) return <div className="py-6 text-ink-2">Loading results…</div>;

  return (
    <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
      <header>
        <h1 className="text-xl sm:text-2xl font-display font-semibold">Results</h1>
        <p className="stat-label">Month-by-month P/L. Click a day to see every bet placed.</p>
      </header>

      <DailyResults
        daily={data.dailyTotals}
        lifetimePL={data.lifetimePL}
      />

      <div className="border-t border-line/40 pt-4 text-xs text-ink-2">
        Strategy verdicts, per-track breakdown, and carryover watch moved to{" "}
        <a href="/analytics" className="text-accent-cyan hover:underline font-mono">Analytics ↗</a>.
      </div>
    </div>
  );
}

type MonthCell = DailyTotal & { future: boolean };

function DailyResults({
  daily, lifetimePL,
}: {
  daily: DailyTotal[];
  lifetimePL: number | null;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "graph">("calendar");

  const todayStr = fmtLocalDay(new Date());
  const currentMonth = todayStr.slice(0, 7);
  const [month, setMonth] = useState<string>(currentMonth); // YYYY-MM

  const byDay = useMemo(() => new Map(daily.map(d => [d.day, d])), [daily]);
  const firstDataMonth = daily.length > 0 ? daily[0].day.slice(0, 7) : currentMonth;

  // Every day of the displayed month; days after today render blank.
  const cells: MonthCell[] = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      const row = byDay.get(day) ?? {
        day, bets: 0, settled: 0, won: 0, staked: 0,
        realizedPL: 0, hitRate: null, roi: null,
      };
      return { ...row, future: day > todayStr };
    });
  }, [month, byDay, todayStr]);

  // Header stats always describe exactly what's rendered: the month's cells
  // in calendar view, the full history in graph view.
  const statDays = view === "calendar" ? cells.filter(d => d.bets > 0) : daily.filter(d => d.bets > 0);
  const statPL = statDays.reduce((s, d) => s + d.realizedPL, 0);
  const bestDay = statDays.reduce<DailyTotal | null>(
    (b, d) => (b == null || d.realizedPL > b.realizedPL ? d : b), null);
  const worstDay = statDays.reduce<DailyTotal | null>(
    (b, d) => (b == null || d.realizedPL < b.realizedPL ? d : b), null);
  const winningDays = statDays.filter(d => d.realizedPL > 0).length;
  const losingDays = statDays.filter(d => d.realizedPL < 0).length;

  const selected = selectedDay ? byDay.get(selectedDay) ?? null : null;

  const monthDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  const monthTitle = monthDate.toLocaleString(undefined, { month: "long", year: "numeric" });
  const canPrev = month > firstDataMonth;
  const canNext = month < currentMonth;
  const shiftMonth = (delta: number) => {
    const d = new Date(monthDate);
    d.setMonth(d.getMonth() + delta);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setSelectedDay(null);
  };

  const statCls = statPL >= 0 ? "text-accent-overlay" : "text-accent-steam";
  const lifetimeCls = (lifetimePL ?? 0) >= 0 ? "text-accent-overlay" : "text-accent-steam";

  return (
    <section>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        {view === "calendar" && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => shiftMonth(-1)} disabled={!canPrev}
              aria-label="Previous month"
              className={clsx("px-2 py-1 rounded border font-mono text-xs",
                canPrev ? "border-line text-ink-1 hover:text-ink-0 hover:border-white/30" : "border-line/40 text-ink-2/40 cursor-default")}>
              ‹
            </button>
            <span className="font-display font-semibold text-sm sm:text-base min-w-[9.5rem] text-center">
              {monthTitle}
            </span>
            <button onClick={() => shiftMonth(1)} disabled={!canNext}
              aria-label="Next month"
              className={clsx("px-2 py-1 rounded border font-mono text-xs",
                canNext ? "border-line text-ink-1 hover:text-ink-0 hover:border-white/30" : "border-line/40 text-ink-2/40 cursor-default")}>
              ›
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 sm:gap-x-4 gap-y-1 text-[11px] sm:text-xs text-ink-2">
          <span><span className="font-mono tabular-nums text-ink-1">{statDays.length}</span> active days</span>
          <span className="text-line">·</span>
          <span title={view === "calendar"
            ? "Realized P/L across the days of this month"
            : "Realized P/L across the whole graph"}>
            {view === "calendar" ? "month" : "total"}{" "}
            <span className={clsx("font-mono tabular-nums font-semibold", statCls)}>
              {statPL >= 0 ? "+" : ""}${statPL.toFixed(0)}
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
          {lifetimePL != null && view === "calendar" && (
            <>
              <span className="text-line">·</span>
              <span title="Realized P/L across every settled bet ever — the same number the Tickets page shows.">
                all-time{" "}
                <span className={clsx("font-mono tabular-nums font-semibold", lifetimeCls)}>
                  {lifetimePL >= 0 ? "+" : ""}${lifetimePL.toFixed(0)}
                </span>
              </span>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs">
          {(["calendar", "graph"] as const).map(v => (
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
        <PerformanceGraph daily={daily} />
      )}

      {view === "calendar" && selected && (
        <DayDetail
          day={selected}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {view === "calendar" && !selected && statDays.length > 0 && (
        <p className="stat-label mt-2">Click a day to see every bet placed.</p>
      )}
    </section>
  );
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

// Cell fill + per-cell ink, chosen by COMPUTED contrast against the blended
// background — not by eyeballing. High-profit cells get a bright fill; the
// dim slate ink-2 that works on dark cells drops to ~1.5:1 contrast there
// (the "+$1.3k day looks broken / data missing" report), and the green P/L
// text disappears into a green fill. For each cell we blend the fill over
// the panel surface, then pick whichever ink (light or near-black) wins on
// WCAG contrast; the P/L value keeps its win/loss accent color only while
// that accent still clears 4.5:1, else falls back to the neutral winner.
const CELL_SURFACE = { r: 10, g: 14, b: 21 }; // bg-1 #0a0e15 behind the grid
const FILL_PROFIT = { r: 16, g: 185, b: 129 };
const FILL_LOSS = { r: 239, g: 68, b: 68 };
const INK_LIGHT = "#e7edf7"; // ink-0
const INK_DARK = "#0b1220";
const ACCENT_PROFIT = "#22c55e";
const ACCENT_LOSS = "#ff3b3b";

function relLum(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const LUM_LIGHT = relLum(0xe7, 0xed, 0xf7);
const LUM_DARK = relLum(0x0b, 0x12, 0x20);
const LUM_ACCENT_PROFIT = relLum(0x22, 0xc5, 0x5e);
const LUM_ACCENT_LOSS = relLum(0xff, 0x3b, 0x3b);

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

interface CellPaint {
  bg: string;
  ink: string;        // day number + bet count
  inkMuted: string;   // same hue, softer — bet count
  plInk: string;      // the P/L value
  darkInk: boolean;   // true when the cell is bright enough to need dark text
}

function paintForPL(pl: number, maxAbs: number): CellPaint {
  if (pl === 0 || maxAbs === 0) {
    return {
      bg: "rgba(255,255,255,0.05)",
      ink: "#9aa6b9", inkMuted: "#5c6678",
      plInk: pl >= 0 ? ACCENT_PROFIT : ACCENT_LOSS,
      darkInk: false,
    };
  }
  const intensity = Math.min(1, Math.abs(pl) / maxAbs);
  const alpha = 0.15 + intensity * 0.65;
  const fill = pl > 0 ? FILL_PROFIT : FILL_LOSS;
  const bgLum = relLum(
    alpha * fill.r + (1 - alpha) * CELL_SURFACE.r,
    alpha * fill.g + (1 - alpha) * CELL_SURFACE.g,
    alpha * fill.b + (1 - alpha) * CELL_SURFACE.b,
  );
  const darkInk = contrast(LUM_DARK, bgLum) > contrast(LUM_LIGHT, bgLum);
  const accent = pl > 0 ? ACCENT_PROFIT : ACCENT_LOSS;
  const accentLum = pl > 0 ? LUM_ACCENT_PROFIT : LUM_ACCENT_LOSS;
  // Solid inks only — semi-transparent or mid-tone "muted" inks fall under
  // 2.2:1 on saturated mid-bright fills (audited). Hierarchy between the day
  // number, bet count, and P/L value comes from size and weight instead.
  const neutral = darkInk ? INK_DARK : INK_LIGHT;
  return {
    bg: `rgba(${fill.r},${fill.g},${fill.b},${alpha.toFixed(3)})`,
    ink: neutral,
    inkMuted: neutral,
    plInk: !darkInk && contrast(accentLum, bgLum) >= 4.5 ? accent : neutral,
    darkInk,
  };
}

function CalendarGrid({
  cells, selectedDay, onSelect,
}: {
  cells: MonthCell[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  if (cells.length === 0) {
    return <div className="panel p-4 text-ink-2 text-sm">No bets this month.</div>;
  }
  const maxAbs = Math.max(1, ...cells.map(c => Math.abs(c.realizedPL)));

  const first = parseDayLocal(cells[0].day);
  const last  = parseDayLocal(cells[cells.length - 1].day);
  const leadPad = first.getDay();
  const tailPad = 6 - last.getDay();
  const padded: (MonthCell | null)[] = [
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
          const dayNum = parseDayLocal(cell.day).getDate();
          const isToday = cell.day === today;
          const isSelected = selectedDay === cell.day;
          const hasBets = cell.bets > 0;
          const paint = paintForPL(hasBets ? cell.realizedPL : 0, maxAbs);
          const plCompact = Math.abs(cell.realizedPL) >= 1000
            ? `${(cell.realizedPL / 1000).toFixed(1)}k`
            : cell.realizedPL.toFixed(0);

          if (cell.future) {
            return (
              <div key={cell.day}
                className="aspect-square sm:aspect-[7/5] rounded-md p-1 sm:p-2 border border-white/5 min-h-[44px] sm:min-h-[54px]">
                <span className="font-mono text-[10px] sm:text-[11px] tabular-nums leading-none text-ink-2/40">
                  {dayNum}
                </span>
              </div>
            );
          }

          return (
            <button
              key={cell.day}
              onClick={() => hasBets && onSelect(cell.day)}
              disabled={!hasBets}
              title={hasBets
                ? `${cell.day} · ${cell.bets} bets · ${cell.realizedPL >= 0 ? "+" : ""}$${cell.realizedPL.toFixed(0)}`
                : `${cell.day} — no bets`}
              style={{ background: hasBets ? paint.bg : "transparent" }}
              className={clsx(
                "aspect-square sm:aspect-[7/5] rounded-md p-1 sm:p-2 flex flex-col justify-between text-left border transition",
                "min-h-[44px] sm:min-h-[54px] overflow-hidden",
                isSelected
                  ? "border-accent-cyan ring-1 ring-accent-cyan/40"
                  : isToday
                    ? "border-accent-cyan/60"
                    : hasBets
                      ? "border-white/10 hover:border-white/30"
                      : "border-white/5",
                !hasBets && "cursor-default opacity-60",
              )}
            >
              <div className="flex items-baseline justify-between gap-0.5">
                <span
                  className={clsx(
                    "font-mono text-[10px] sm:text-[11px] tabular-nums leading-none",
                    (isToday || paint.darkInk) && "font-semibold",
                  )}
                  // Today keeps its cyan number only while the cell is dark
                  // enough to read it; on bright fills the cyan border above
                  // carries the marker and the number uses the contrast ink.
                  style={{ color: isToday && !paint.darkInk ? "#22d3ee" : hasBets ? paint.ink : "#5c6678" }}
                >
                  {dayNum}
                </span>
                {hasBets && (
                  <span className="font-mono text-[9px] tabular-nums leading-none hidden sm:inline"
                    style={{ color: paint.inkMuted }}>
                    {cell.bets}b
                  </span>
                )}
              </div>
              {hasBets ? (
                <div className="font-mono tabular-nums font-semibold text-right leading-none"
                  style={{ color: paint.plInk }}>
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

// Cumulative realized P/L since the first bet, one point per calendar day.
// Days with no bets carry the total flat so the time axis is honest.
function PerformanceGraph({ daily }: { daily: DailyTotal[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    const active = daily.filter(d => d.bets > 0);
    if (active.length === 0) return [];
    const map = new Map(active.map(d => [d.day, d]));
    const out: { day: string; pl: number; cum: number }[] = [];
    let cum = 0;
    const end = parseDayLocal(fmtLocalDay(new Date()));
    for (let d = parseDayLocal(active[0].day); d <= end; d.setDate(d.getDate() + 1)) {
      const key = fmtLocalDay(d);
      const pl = map.get(key)?.realizedPL ?? 0;
      cum += pl;
      out.push({ day: key, pl, cum });
    }
    return out;
  }, [daily]);

  if (points.length === 0) {
    return <div className="panel p-4 text-ink-2 text-sm">No settled bets yet.</div>;
  }

  const W = 800, H = 280, padL = 52, padR = 16, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const cums = points.map(p => p.cum);
  const lo = Math.min(0, ...cums);
  const hi = Math.max(0, ...cums);
  const span = Math.max(1, hi - lo);
  const yOf = (v: number) => padT + (hi - v) / span * innerH;
  const xOf = (i: number) => points.length === 1
    ? padL + innerW / 2
    : padL + (i / (points.length - 1)) * innerW;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.cum).toFixed(1)}`).join(" ");
  const zeroY = yOf(0);
  const lastPt = points[points.length - 1];

  const idxLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    const idx = Math.round((x - padL) / innerW * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const h = hover != null ? points[hover] : null;
  const fmt$ = (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(0)}`;
  // Tooltip box flips to the left edge of the crosshair past mid-chart.
  const tipW = 148, tipH = 44;
  const tipX = h != null ? Math.min(W - padR - tipW, Math.max(padL, xOf(hover!) + (xOf(hover!) > W / 2 ? -tipW - 10 : 10))) : 0;
  const tipY = h != null ? Math.max(padT, Math.min(H - padB - tipH, yOf(h.cum) - tipH / 2)) : 0;

  return (
    <div className="panel p-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 500 }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* zero baseline + extents */}
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY}
          stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3"/>
        <text x={padL - 6} y={zeroY + 4} textAnchor="end"
          fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">$0</text>
        {hi > 0 && (
          <text x={padL - 6} y={padT + 4} textAnchor="end"
            fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">{fmt$(hi)}</text>
        )}
        {lo < 0 && (
          <text x={padL - 6} y={padT + innerH + 4} textAnchor="end"
            fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">{fmt$(lo)}</text>
        )}

        <path d={path} fill="none" stroke="#22d3ee" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round"/>

        {/* endpoint marker + direct label of the current total */}
        <circle cx={xOf(points.length - 1)} cy={yOf(lastPt.cum)} r={3.5} fill="#22d3ee"/>
        <text x={Math.min(xOf(points.length - 1) + 8, W - padR)} y={yOf(lastPt.cum) - 8}
          textAnchor="end" fill="#e7edf7" fontSize={12} fontWeight={600} fontFamily="monospace">
          {fmt$(lastPt.cum)}
        </text>

        {idxLabels.map(i => (
          <text key={i} x={xOf(i)} y={H - 6} textAnchor="middle"
            fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">
            {points[i].day.slice(5)}
          </text>
        ))}

        {h != null && (
          <g pointerEvents="none">
            <line x1={xOf(hover!)} y1={padT} x2={xOf(hover!)} y2={padT + innerH}
              stroke="rgba(255,255,255,0.25)"/>
            <circle cx={xOf(hover!)} cy={yOf(h.cum)} r={4} fill="#22d3ee"
              stroke="#0a0e15" strokeWidth={1.5}/>
            <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={5}
              fill="#10151f" stroke="rgba(255,255,255,0.15)"/>
            <text x={tipX + 9} y={tipY + 17} fill="#9aa6b9" fontSize={10} fontFamily="monospace">
              {h.day} · day {fmt$(h.pl)}
            </text>
            <text x={tipX + 9} y={tipY + 34} fill="#e7edf7" fontSize={12} fontWeight={600} fontFamily="monospace">
              total {fmt$(h.cum)}
            </text>
          </g>
        )}
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
    fetch(apiUrl(`/api/stats/day?date=${day.day}&tz=${new Date().getTimezoneOffset()}`))
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
