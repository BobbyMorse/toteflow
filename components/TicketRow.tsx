"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Ticket } from "@/lib/types";
import { verificationLinks } from "@/lib/verification";
import { isMeasureOnly } from "@/lib/strategies/measure-only";
import Link from "next/link";
import clsx from "clsx";

export function sourceFromRaceId(raceId: string): string {
  if (raceId.startsWith("TVG-")) return "tvg";
  return "unknown";
}

// Human-readable name for a bet type code. Handicappers know "P3" but the
// friendly label removes any ambiguity for someone new to the platform.
const BET_TYPE_LABELS: Record<Ticket["type"], string> = {
  WIN: "Win",
  PLACE: "Place",
  SHOW: "Show",
  EXACTA: "Exacta",
  TRIFECTA: "Trifecta",
  DD: "Daily Double",
  P3: "Pick 3",
  P4: "Pick 4",
  P5: "Pick 5",
  P6: "Pick 6",
  J6: "Jackpot 6",
};
export function betTypeLabel(type: Ticket["type"]): string {
  return BET_TYPE_LABELS[type] ?? type;
}

export function EVExplainer({
  trueP, odds, takeout, liveEv,
  capturedEv, closingEv,
  context,
}: {
  trueP?: number | null;
  odds?: number | null;
  takeout?: number | null;
  liveEv?: number | null;
  capturedEv?: number | null;
  closingEv?: number | null;
  context: "live" | "history";
}) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const haveLive = trueP != null && odds != null && takeout != null;
  const TOOLTIP_W = 288; // matches w-72

  function open() {
    const el = iconRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Estimate height — we don't know the rendered size yet. Tooltip is
    // capped by content; 240px covers the worst case (live with all rows).
    const estH = 240;

    // Vertical: prefer below the icon, flip above if it would overflow.
    let top = r.bottom + 6;
    if (top + estH > vh - margin) top = Math.max(margin, r.top - estH - 6);

    // Horizontal: align with icon's left edge, clamp to viewport.
    let left = r.left;
    if (left + TOOLTIP_W > vw - margin) left = vw - TOOLTIP_W - margin;
    if (left < margin) left = margin;

    setPos({ left, top });
  }
  function close() { setPos(null); }

  return (
    <>
      <span
        ref={iconRef}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        tabIndex={0}
        className="cursor-help text-ink-2 hover:text-ink-1 text-[10px] font-mono border border-line/60 hover:border-ink-2 rounded-full w-3.5 h-3.5 inline-flex items-center justify-center ml-1 select-none align-middle"
        aria-label="How EV is calculated"
      >i</span>
      {pos && typeof document !== "undefined" && createPortal(
        <div
          style={{ position: "fixed", left: pos.left, top: pos.top, width: TOOLTIP_W }}
          className="z-[1000] p-2.5 rounded-md bg-bg-1 border border-line/80 shadow-xl text-[11px] leading-snug text-ink-1 normal-case tracking-normal font-normal pointer-events-none"
        >
          {context === "live" && haveLive && (() => {
            const fair = modelFairDecimal(trueP!, takeout!);
            const modelOn = isModelContributing(trueP!, odds!);
            return (
              <div className="space-y-0.5 font-mono text-[10.5px] text-ink-1">
                <div className="stat-label text-ink-2 mb-1 not-italic">This bet, right now</div>
                <div>P (true win prob) = <span className="text-ink-0">{(trueP! * 100).toFixed(1)}%</span></div>
                <div>odds = <span className="text-ink-0">{odds!.toFixed(2)}</span> <span className="text-ink-2">({decimalToFractional(odds!)})</span></div>
                <div>takeout = <span className="text-ink-0">{(takeout! * 100).toFixed(0)}%</span></div>
                {fair != null && (
                  <div>
                    fair odds = <span className="text-ink-0">{fair.toFixed(2)}</span>{" "}
                    <span className="text-ink-2">({decimalToFractional(fair)})</span>
                    <span className="text-ink-2"> — break-even from P + takeout</span>
                  </div>
                )}
                {!modelOn && (
                  <div className="text-accent-warn">
                    model off — P snapped to market-implied. EV ≈ −takeout by construction.
                  </div>
                )}
                <div className="pt-1">
                  ({trueP!.toFixed(3)} × {(odds! - 1).toFixed(2)} × {(1 - takeout!).toFixed(2)} − {(1 - trueP!).toFixed(3)}) × 100
                </div>
                {liveEv != null && (
                  <div>
                    = <span className={clsx("font-semibold",
                        liveEv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                        {liveEv >= 0 ? "+" : ""}{liveEv.toFixed(1)}%
                      </span>
                  </div>
                )}
              </div>
            );
          })()}
          {context === "live" && !haveLive && (
            <div className="text-ink-2 text-[10.5px] italic">
              Live model inputs not available for this bet — showing formula only.
            </div>
          )}
          {context === "history" && (capturedEv != null || closingEv != null) && (
            <div className="text-[10.5px] text-ink-1 space-y-0.5">
              <div className="stat-label text-ink-2 mb-1 not-italic">This bet</div>
              {capturedEv != null && (
                <div>
                  <span className="font-mono text-ink-2">at fire:</span>{" "}
                  <span className={clsx("font-mono",
                    capturedEv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                    {capturedEv >= 0 ? "+" : ""}{capturedEv.toFixed(1)}%
                  </span>
                  {" "}<span className="text-ink-2">— frozen at strategy match</span>
                </div>
              )}
              {closingEv != null && (
                <div>
                  <span className="font-mono text-ink-2">at close:</span>{" "}
                  <span className={clsx("font-mono",
                    closingEv >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                    {closingEv >= 0 ? "+" : ""}{closingEv.toFixed(1)}%
                  </span>
                  {" "}<span className="text-ink-2">
                    — scaled from fire EV by odds drift (constant model prob)
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-2 pt-2 border-t border-line/40 text-[10px] text-ink-2 space-y-1">
            <div className="font-mono text-ink-1 text-[10.5px]">
              EV% = (P × (odds−1) × (1−takeout) − (1−P)) × 100
            </div>
            <div>
              <span className="font-mono text-ink-1">P</span> blends model + market ·{" "}
              <span className="font-mono text-ink-1">odds</span> live decimal ·{" "}
              <span className="font-mono text-ink-1">takeout</span> track pool cut
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Break-even decimal odds implied by the model. Derived from the same EV
// formula the adapter uses (EV = trueP × (odds−1) × (1−takeout) − (1−trueP)):
// setting EV = 0 gives odds = 1 + (1 − trueP) / (trueP × (1 − takeout)).
// Returns null when inputs are missing or degenerate.
export function modelFairDecimal(trueP: number | null | undefined, takeout: number | null | undefined): number | null {
  if (trueP == null || trueP <= 0 || trueP >= 1) return null;
  if (takeout == null || takeout >= 1 || takeout < 0) return null;
  return 1 + (1 - trueP) / (trueP * (1 - takeout));
}

// True when the model is actually contributing to trueP. The TVG adapter
// snaps trueP to marketImpliedP whenever decimal odds cross the 60/1
// long-shot cutoff (or the horse is scratched, or the race-level model
// quality is "low"). Detecting the collapse in the UI lets us flag "model
// off — long-shot cutoff" instead of letting the fair-odds line silently
// echo the market price back.
export function isModelContributing(trueP: number | null | undefined, decimalOdds: number | null | undefined): boolean {
  if (trueP == null || decimalOdds == null || decimalOdds <= 1) return false;
  const marketImpliedP = 1 / Math.max(1.2, decimalOdds);
  return Math.abs(trueP - marketImpliedP) > 0.002;
}

export function decimalToFractional(d: number): string {
  if (!d || d <= 1) return "?";
  const dec = d - 1;
  // Approximate to common fractions
  const pairs: [number, [number, number]][] = [];
  for (let den = 1; den <= 10; den++) {
    for (let num = 1; num <= 99; num++) {
      pairs.push([num / den, [num, den]]);
    }
  }
  let best = pairs[0];
  let bestErr = Math.abs(best[0] - dec);
  for (const p of pairs) {
    const err = Math.abs(p[0] - dec);
    if (err < bestErr) { best = p; bestErr = err; }
  }
  return `${best[1][0]}/${best[1][1]}`;
}

export function TicketRow({ ticket: t }: { ticket: Ticket }) {
  const settled = t.status === "won" || t.status === "lost";
  // Measure-only strategies (e.g. pure-steam) book every bet as a $0 shadow, so
  // realizedPL is always 0 and the real outcome lives in shadowPL. Show that
  // hypothetical instead — otherwise a winner reads as a misleading "+$0.00".
  const measureOnly = isMeasureOnly(t.strategyId);
  const pl = measureOnly ? (t.shadowPL ?? 0) : (t.realizedPL ?? 0);
  const modeLabel = measureOnly ? "measure" : t.shadow ? "shadow" : t.mode;
  const modeTitle = measureOnly
    ? "Measure-only: this strategy books every bet as a $0 shadow by design — it never touches the bankroll. P/L shown is the hypothetical result at its shadow stake; the aggregate lives in the shadowed slice on Analytics."
    : t.shadow
      ? "Shadow: another strategy already covered this bet — tracked for attribution, no bankroll"
      : undefined;
  const plTitle = measureOnly
    ? "Hypothetical P/L at the strategy's shadow stake — measure-only, never touches the bankroll"
    : undefined;
  // CLV = WIN-only — the closing snapshot stores WIN-pool odds; PLACE/SHOW/
  // exotic bets aren't scored against that pool.
  const clv = t.type === "WIN" && t.closingOdds && t.capturedOdds
    ? ((t.capturedOdds - t.closingOdds) / t.closingOdds) * 100
    : null;
  // NOTE: no client-side P/EV consistency check here. It can't be done
  // honestly — the fire-time takeout isn't persisted on the ticket, so any
  // recompute guesses 0.16 and false-flags tracks like Tampa (18.5%) or
  // Santa Anita (15.43%). It also mis-applied the WIN formula to PLACE/SHOW
  // (Dr.Z pool math). Capture-time consistency is enforced server-side in
  // autobook (P and EV paired atomically from the same strategy re-eval).
  // Closing EV grades the bet WE locked in.
  // - WIN: derive by scaling captured EV by the odds drift (constant-trueP:
  //   same horse, same model probability, just rescaled payout). We prefer
  //   the derivation over any stored value because old rows carried the
  //   race-off market-price EV, which collapses to ~-takeout on bombs.
  // - PLACE: use the stored value directly. It's the Dr.Z Ziemba/Hausch EV
  //   re-computed against the closing PLACE-pool composition, snapshotted
  //   pre-off by autobook. No simple scaling exists for PLACE — the EV
  //   depends on the full pool, not just this horse's odds.
  const derivedClosingEV = t.type === "WIN"
    && t.closingOdds && t.closingOdds > 0
    && t.capturedOdds && t.capturedOdds > 0
    ? (t.capturedEV + 100) * (t.closingOdds / t.capturedOdds) - 100
    : null;
  const effectiveClosingEV = derivedClosingEV ?? t.closingEV ?? null;
  const showClosingEV = (t.type === "WIN" || t.type === "PLACE") && effectiveClosingEV != null;
  // Booked = the odds we promoted at (what a human would have gotten on FanDuel).
  // Final  = the closing tote odds (what the payout was actually computed from).
  // The gap between them is CLV; we surface both so the user can audit the gap directly.
  const bookedOdds = t.capturedOdds > 0 ? decimalToFractional(t.capturedOdds) : "—";
  const finalOdds = t.closingOdds && t.closingOdds > 0 ? decimalToFractional(t.closingOdds) : null;
  // PLACE/SHOW don't pay the WIN odds — capturedOdds/closingOdds are the
  // horse's win price and don't belong in this column for those bets. When a
  // place/show bet cashes we know the EXACT price the pool paid:
  // payout/stake = realizedPL/stake + 1. Losers never cashed (no place price);
  // open bets have no tote place quote yet.
  const isPlaceShow = t.type === "PLACE" || t.type === "SHOW";
  const placeVerb = t.type === "SHOW" ? "show" : "place";
  const placePrice = isPlaceShow && t.status === "won" && t.stake > 0 && t.realizedPL != null
    ? t.realizedPL / t.stake + 1
    : null;
  const placeOddsTitle = placePrice != null
    ? `${betTypeLabel(t.type)} price paid — $${((t.realizedPL ?? 0) + t.stake).toFixed(2)} back on $${t.stake.toFixed(0)} from the ${placeVerb} pool`
    : t.status === "lost"
      ? `Did not ${placeVerb} — no payout`
      : `No tote ${placeVerb} price until settled (win odds don't apply to a ${placeVerb} bet)`;
  // Finish order from the grader (top-4). For single-runner bets we can also
  // call out where our pick actually landed.
  const finishOrder = t.winners ?? [];
  const myPick = t.selections[0];
  const myFinishIdx = settled && myPick ? finishOrder.indexOf(myPick) : -1;
  const ordinal = (i: number) =>
    i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;
  const myFinishLabel = myFinishIdx >= 0 ? ordinal(myFinishIdx) : null;
  return (
    <div className="px-3 sm:px-4 py-3 sm:py-2 text-sm">
      {/* MOBILE: stacked card. DESKTOP: 9-column grid (unchanged). */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col min-w-0 gap-0.5">
            <Link href={`/race/${t.raceId}`} className="font-mono truncate">
              <span className="text-accent-cyan">
                {t.trackCode ?? t.raceId} {t.raceNumber ? `R${t.raceNumber}` : ""}
              </span>
              {t.trackName && t.trackName !== t.trackCode && (
                <span className="text-[10px] text-ink-2 normal-case ml-2" title={t.trackName}>
                  {t.trackName}
                </span>
              )}
            </Link>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-2 leading-tight">
              {new Date(t.placedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {" · "}
              {new Date(t.placedAt).toLocaleTimeString([], { hour12: false })}
              {" · "}
              <span className="normal-case">{t.strategyId ?? "manual"}</span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className={clsx("chip border",
              t.shadow
                ? "border-line/60 bg-bg-1 text-ink-2"
                : t.mode === "auto"
                  ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                  : "border-line text-ink-2",
            )} title={modeTitle}>
              {modeLabel}
            </span>
            {!settled ? (
              <span className="chip border border-line text-ink-2">{t.status}</span>
            ) : (
              <span className={clsx("chip border", t.status === "won"
                ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay"
                : "border-accent-steam/40 bg-accent-steam/10 text-accent-steam")}>
                {t.status}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="chip border border-line">{t.type}</span>
          <span className="font-mono">#{t.selections.join("-")}</span>
          {t.horseName && <span className="text-ink-1">{t.horseName}</span>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
          <div>
            <div className="stat-label">stake</div>
            <div className="text-ink-0">${t.stake.toFixed(0)}</div>
          </div>
          <div title={isPlaceShow ? placeOddsTitle : undefined}>
            <div className="stat-label">{isPlaceShow ? `${placeVerb} price` : "odds"}</div>
            <div className="text-ink-1 leading-tight">
              {isPlaceShow ? (
                placePrice != null
                  ? <span className="text-ink-0">{decimalToFractional(placePrice)}</span>
                  : <span className="text-ink-2">—</span>
              ) : (
                <>
                  {bookedOdds}
                  {finalOdds && (
                    <>
                      <span className="text-ink-2 mx-1">→</span>
                      <span className="text-ink-0">{finalOdds}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div>
            <div className="stat-label">EV</div>
            {showClosingEV ? (
              <div className="leading-tight">
                <span className={clsx("font-semibold",
                  effectiveClosingEV! >= 0 ? "text-accent-overlay" : "text-accent-steam")}>
                  {effectiveClosingEV! >= 0 ? "+" : ""}{effectiveClosingEV!.toFixed(1)}%
                </span>
                <div className="text-[10px] text-ink-2">was {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%</div>
              </div>
            ) : (
              <span className={clsx(
                t.capturedEV > 0 ? "text-accent-overlay" : "text-accent-steam")}>
                {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {settled && (
          <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap text-xs font-mono tabular-nums">
            <span className={clsx("font-semibold",
              pl >= 0 ? "text-accent-overlay" : "text-accent-steam")} title={plTitle}>
              P/L {measureOnly ? "~" : ""}{pl >= 0 ? "+" : ""}${pl.toFixed(2)}
            </span>
            {clv != null && (
              <span className={clsx(
                clv >= 0 ? "text-accent-overlay/70" : "text-accent-steam/70")}>
                CLV {clv >= 0 ? "+" : ""}{clv.toFixed(1)}%
              </span>
            )}
          </div>
        )}
        {t.reason && (
          <div className="text-[11px] text-ink-2 italic">
            {t.reason}
            {t.stagedEV != null && Math.abs(t.stagedEV - t.capturedEV) > 1 && (
              <div className="mt-1">staged at {t.stagedEV >= 0 ? "+" : ""}{t.stagedEV.toFixed(1)}% EV — price moved before fire</div>
            )}
          </div>
        )}
      </div>

      <div className="hidden sm:grid grid-cols-[100px_60px_110px_110px_minmax(160px,1fr)_60px_100px_74px_100px] gap-3 items-center">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-2 leading-tight flex flex-col">
          <span className="text-ink-1">
            {new Date(t.placedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
          </span>
          <span>{new Date(t.placedAt).toLocaleTimeString([], { hour12: false })}</span>
        </span>
        <span className={clsx("chip border",
          t.shadow
            ? "border-line/60 bg-bg-1 text-ink-2"
            : t.mode === "auto"
              ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
              : "border-line text-ink-2",
        )} title={modeTitle}>
          {modeLabel}
        </span>
        <Link href={`/race/${t.raceId}`} className="font-mono truncate leading-tight flex flex-col">
          <span className="text-accent-cyan">
            {t.trackCode ?? t.raceId} {t.raceNumber ? `R${t.raceNumber}` : ""}
          </span>
          {t.trackName && t.trackName !== t.trackCode && (
            <span className="text-[10px] text-ink-2 normal-case truncate" title={t.trackName}>
              {t.trackName}
            </span>
          )}
        </Link>
        <span className="font-mono text-[11px] text-ink-2 truncate">
          {t.strategyId ?? "manual"}
        </span>
        <span className="truncate">
          <span className="chip border border-line mr-2">{t.type}</span>
          #{t.selections.join("-")}
          {t.horseName && <span className="text-ink-1 ml-2">{t.horseName}</span>}
        </span>
        <span className="font-mono tabular-nums text-right">${t.stake.toFixed(0)}</span>
        <span className="font-mono tabular-nums text-right text-xs"
          title={isPlaceShow ? placeOddsTitle : "Odds we booked at → final tote odds"}>
          {isPlaceShow ? (
            placePrice != null
              ? <span className="text-ink-0">{decimalToFractional(placePrice)}</span>
              : <span className="text-ink-2">—</span>
          ) : (
            <>
              <span className="text-ink-1">{bookedOdds}</span>
              {finalOdds && (
                <>
                  <span className="text-ink-2 mx-1">→</span>
                  <span className="text-ink-0">{finalOdds}</span>
                </>
              )}
            </>
          )}
        </span>
        <span className="text-right text-xs flex flex-col items-end leading-tight">
          {showClosingEV ? (
            <>
              <span className={clsx("font-mono tabular-nums font-semibold",
                effectiveClosingEV! >= 0 ? "text-accent-overlay" : "text-accent-steam")}
                title={t.type === "PLACE"
                  ? "Closing PLACE EV — Dr.Z Ziemba/Hausch formula re-run against the closing PLACE-pool composition (snapshotted pre-off)."
                  : "Closing EV at our captured price — scaled from fire-time EV by the odds drift. Constant-trueP assumption: same horse, same model probability, just rescaled payout."}>
                {effectiveClosingEV! >= 0 ? "+" : ""}{effectiveClosingEV!.toFixed(1)}%
                <EVExplainer
                  context="history"
                  capturedEv={t.capturedEV}
                  closingEv={effectiveClosingEV}
                />
              </span>
              <span className="font-mono tabular-nums text-[10px] text-ink-2"
                title="EV captured at fire moment — what made the strategy fire">
                was {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
              </span>
            </>
          ) : (
            <span className={clsx("font-mono tabular-nums",
              t.capturedEV > 0 ? "text-accent-overlay" : "text-accent-steam")}
              title={t.type === "WIN" || t.type === "PLACE"
                ? "EV captured at fire moment · closing EV pending (race not settled, or pool-pricing bet without a per-runner closing snapshot)"
                : `EV captured at fire moment · closing EV not tracked for ${t.type}`}>
              {t.capturedEV >= 0 ? "+" : ""}{t.capturedEV.toFixed(1)}%
              <EVExplainer
                context="history"
                capturedEv={t.capturedEV}
              />
            </span>
          )}
        </span>
        <span className="text-right">
          {!settled ? (
            <span className="chip border border-line text-ink-2">{t.status}</span>
          ) : (
            <div className="flex flex-col items-end">
              <span className={clsx("chip border", t.status === "won"
                ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay"
                : "border-accent-steam/40 bg-accent-steam/10 text-accent-steam")}>
                {t.status}
              </span>
              <span className={clsx("font-mono tabular-nums text-xs mt-0.5",
                pl >= 0 ? "text-accent-overlay" : "text-accent-steam")} title={plTitle}>
                {measureOnly ? "~" : ""}{pl >= 0 ? "+" : ""}${pl.toFixed(2)}
              </span>
              {clv != null && (
                <span className={clsx("font-mono tabular-nums text-[10px]",
                  clv >= 0 ? "text-accent-overlay/70" : "text-accent-steam/70")}>
                  CLV {clv >= 0 ? "+" : ""}{clv.toFixed(1)}%
                </span>
              )}
            </div>
          )}
        </span>
      </div>
      {t.reason && (
        <div className="hidden sm:block mt-0.5 sm:ml-[250px] text-[11px] text-ink-2 italic">
          {t.reason}
          {t.stagedEV != null && Math.abs(t.stagedEV - t.capturedEV) > 1 && (
            <div className="mt-0.5">staged at {t.stagedEV >= 0 ? "+" : ""}{t.stagedEV.toFixed(1)}% EV — price moved before fire</div>
          )}
        </div>
      )}
      {settled && finishOrder.length > 0 && (
        <div className="mt-0.5 sm:ml-[250px] text-[11px] font-mono text-ink-2 flex flex-wrap items-baseline gap-x-2">
          {t.legs?.length ? (
            <>
              <span className="uppercase tracking-wider">legs:</span>
              {t.legs.map((leg, i) => {
                const winner = finishOrder[i];
                const hit = winner != null && leg.selections.includes(winner);
                return (
                  <span key={i} className="whitespace-nowrap">
                    <span className="text-ink-2">R{leg.raceNumber}</span>
                    <span className="text-ink-2 mx-1">→</span>
                    <span className={clsx("font-semibold",
                      hit ? "text-accent-overlay" : "text-accent-steam")}>
                      #{winner ?? "?"}
                    </span>
                    <span className={clsx("ml-1", hit ? "text-accent-overlay" : "text-accent-steam")}>
                      {hit ? "✓" : "✗"}
                    </span>
                    <span className="text-ink-2/70 ml-1">(of {leg.selections.join("-")})</span>
                    {i < t.legs!.length - 1 && <span className="text-ink-2/40 ml-2">·</span>}
                  </span>
                );
              })}
            </>
          ) : (
            <>
              <span className="uppercase tracking-wider">finish:</span>
              {finishOrder.map((p, i) => {
                // Highlight every runner we picked, not just selections[0].
                // Won ticket → green. Lost: yellow when the pick landed in the
                // exact slot we bet it for (selection order = finish order),
                // red when it hit the board in the wrong slot. Picks that
                // finished off the board simply never appear here.
                const selIdx = t.selections.indexOf(p);
                return (
                  <span key={i} className={clsx(
                    selIdx >= 0
                      ? clsx("font-semibold",
                          t.status === "won" ? "text-accent-overlay"
                          : selIdx === i ? "text-accent-warn"
                          : "text-accent-steam")
                      : "text-ink-1",
                  )}>
                    {i + 1}. #{p}
                  </span>
                );
              })}
              {t.selections.length === 1 && (myFinishLabel
                ? <span className="text-ink-2">· pick #{myPick} → {myFinishLabel}</span>
                : (myPick && <span className="text-ink-2">· pick #{myPick} off board</span>))}
            </>
          )}
          <VerifyLinksInline ticket={t} settled={settled} />
        </div>
      )}
      {!settled && finishOrder.length === 0 && <VerifyLinks ticket={t} />}
    </div>
  );
}

// For settled/void tickets, only the result chart matters — pre-race booking
// and live-simulcast links are dead weight. For open/staged tickets we still
// show the full set (the user might actually book or watch).
function relevantVerifyLinks(t: Ticket, settled: boolean) {
  const source = sourceFromRaceId(t.raceId);
  const all = verificationLinks({
    source,
    trackCode: t.trackCode ?? "",
    trackName: t.trackName,
    raceNumber: t.raceNumber ?? 0,
    postTime: t.postTime ?? t.placedAt,
  });
  if (!settled) return all;
  return all.filter(l => l.label.endsWith("Result"));
}

function VerifyLinksInline({ ticket: t, settled }: { ticket: Ticket; settled: boolean }) {
  const links = relevantVerifyLinks(t, settled);
  if (!links.length) return null;
  return (
    <>
      <span className="text-ink-2/60">·</span>
      {links.map(l => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
           title={l.description}
           className="text-accent-cyan/80 hover:text-accent-cyan hover:underline font-mono">
          {l.label} ↗
        </a>
      ))}
    </>
  );
}

function VerifyLinks({ ticket: t }: { ticket: Ticket }) {
  // Void/scratched tickets: race didn't run, so keep it minimal. If a result
  // link exists it's still the best place to confirm the scratch.
  const links = relevantVerifyLinks(t, true);
  if (!links.length) return null;
  return (
    <div className="mt-0.5 sm:ml-[250px] text-[10px] flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-ink-2 font-mono uppercase tracking-wider">verify:</span>
      {links.map(l => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
           title={l.description}
           className="text-accent-cyan/80 hover:text-accent-cyan hover:underline font-mono">
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}
