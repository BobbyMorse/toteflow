// Server-side results-grader. Polls TVG for finished races, settles open
// tickets, computes realized P/L and closing-line value (CLV). Also pushes
// every observed final race into RaceResults so same-day strategies (like
// track-bias) have a shared history to query.
import { Tickets, Closing, deriveClosingEV } from "./storage";
import { RaceResults } from "./race-results";
import { stampSnapshotResults, purgeUnstampedSnapshots } from "./runner-snapshots";
import type { Ticket } from "./types";

const ENDPOINT = "https://service.tvg.com/graph/v2/query";

const RESULTS_QUERY = `{
  races {
    id number trackCode distance
    surface { name }
    status { code name }
    results {
      runners { biNumber finishPosition winPayoff placePayoff showPayoff betAmount finishStatus }
      payoffs { wagerAmount wagerType { code } selections { selection payoutAmount } }
    }
  }
}`;

interface TvgPayoff {
  wagerAmount: number | null;
  wagerType: { code: string } | null;
  selections: Array<{ selection: string | null; payoutAmount: number | null }> | null;
}

interface TvgResults {
  id: string;
  number: string;
  trackCode: string;
  distance: string | null;
  surface: { name: string } | null;
  status: { code: string; name: string } | null;
  results: {
    runners: Array<{
      biNumber: number; finishPosition: number | null;
      winPayoff: number | null; placePayoff: number | null; showPayoff: number | null;
      betAmount: number | null; finishStatus: string | null;
    }> | null;
    payoffs: TvgPayoff[] | null;
  } | null;
}

// Multi-race wagers (need every leg's race result before settling). DD is a
// 2-leg pick — same grading shape as Pick-3/4/5/6/J6.
const PICKN_TYPES = new Set<Ticket["type"]>(["DD", "P3", "P4", "P5", "P6", "J6"]);
// Single-race multi-pick wagers. EXACTA = top-2 box (any order). TRIFECTA =
// top-3 box (any order). Box-only by default — the auto-booker doesn't expose
// straight-vs-box yet, and box is the conservative/correct hit-rate for the
// model-driven strategies that build these tickets.
const EXOTIC_IN_RACE_TYPES = new Set<Ticket["type"]>(["EXACTA", "TRIFECTA"]);

type TvgResultRunner = NonNullable<NonNullable<TvgResults["results"]>["runners"]>[number];

// Ticket type → TVG payoff wagerType code. Multi-race payoffs (DB/P3/…)
// post on the LAST leg's race results (verified empirically: 79/83 DD
// payoffs match the posting race's winner as the second leg).
const PAYOFF_CODE: Partial<Record<Ticket["type"], string>> = {
  EXACTA: "EX", TRIFECTA: "TR", DD: "DB",
  P3: "P3", P4: "P4", P5: "P5", P6: "P6",
};

// Parse a payoff selection string into per-position program numbers.
// Plain form: "5-2-3". Pick-N full/consolation form: "4 OF  4 1-8-3-6" —
// only full hits (N OF N) count here; consolations return null.
function parsePayoffCombo(sel: string | null): string[] | null {
  if (!sel) return null;
  const m = sel.match(/^(\d+)\s+OF\s+(\d+)\s+(.*)$/i);
  if (m) {
    if (m[1] !== m[2]) return null;   // consolation payoff (e.g. 5 OF 6)
    return m[3].trim().split("-").map(s => s.trim());
  }
  return sel.trim().split("-").map(s => s.trim());
}

// Sum the real tote payout for the combos our ticket covers. `covers` decides
// whether a winning combo belongs to the ticket (box membership for in-race
// exotics, per-leg membership for multi-race). `perComboStake` is the ticket
// stake divided by covered combos — TVG payoffs are per `wagerAmount` (usually
// $1), so scale to what we actually had riding on the winning combo. Returns
// null when the race exposes no payoff for this wager type (fall back to the
// book-time estimate). Dead heats produce multiple selection entries; we sum
// every one the ticket covers.
function realPayout(
  race: TvgResults,
  code: string,
  perComboStake: number,
  covers: (combo: string[]) => boolean,
): number | null {
  const payoffs = race.results?.payoffs ?? [];
  let found = false;
  let total = 0;
  for (const p of payoffs) {
    if (p.wagerType?.code !== code) continue;
    const base = p.wagerAmount ?? 0;
    if (base <= 0) continue;
    for (const s of p.selections ?? []) {
      const combo = parsePayoffCombo(s.selection);
      if (!combo) continue;
      found = true;
      if (s.payoutAmount == null || !covers(combo)) continue;
      total += (perComboStake / base) * s.payoutAmount;
    }
  }
  return found ? total : null;
}

// Any open ticket more than this many ms past its postTime gets voided by the
// janitor pass. Bounds the live-opportunities panel and recovers the staked
// dollars from analytics' ROI denominator. Set generously to cover the
// last-leg-plus-results window for Pick-N (worst case ~3h between first and
// last leg, plus result-posting lag).
const STALE_OPEN_MS = 4 * 60 * 60_000;

// TVG marks scratched runners with a null/empty finishStatus AND no finishPosition.
// Runners that ran get finishStatus populated (WIN/PLC/SHW/etc.) even if off-board.
function isScratched(rn: TvgResultRunner | undefined): boolean {
  if (!rn) return false;
  return !rn.finishStatus && rn.finishPosition == null;
}

class Grader {
  // Marker bumped whenever settle logic adds new ticket types — read by the
  // HMR staleness check below so dev reloads pick up the new settle paths.
  readonly version = 6;
  started = false;
  lastTick = 0;
  inFlight: Promise<void> | null = null;
  intervalMs = 30_000;
  log: { ts: number; msg: string }[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    this.note("grader started");
    void this.tickIfDue();
    // Self-scheduled heartbeat so grading runs 24/7 on Fly without an open
    // browser. tickIfDue() gates real work by intervalMs (30s).
    this.heartbeat = setInterval(() => { void this.tickIfDue(); }, 5_000);
    if (typeof (this.heartbeat as any)?.unref === "function") (this.heartbeat as any).unref();
  }
  async tickIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTick < this.intervalMs) return;
    if (this.inFlight) return this.inFlight;
    this.lastTick = now;
    this.inFlight = this.tick().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  forceTick() { this.lastTick = 0; return this.tickIfDue(); }
  note(msg: string) {
    this.log.push({ ts: Date.now(), msg });
    if (this.log.length > 200) this.log.shift();
  }
  recentLog(n = 50) { return this.log.slice(-n).reverse(); }

  private async tick() {
    // Janitor runs unconditionally — handles non-TVG tickets (the TVG settle
    // loop below would skip them) and TVG tickets whose race dropped off the
    // live feed before grading caught the final.
    this.sweepStaleOpen();

    const open = Tickets.list().filter(t => t.status === "open" && t.raceId.startsWith("TVG-"));
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "ToteFlow/0.1" },
        body: JSON.stringify({ query: RESULTS_QUERY }),
        cache: "no-store",
      });
      if (!res.ok) { this.note(`fetch HTTP ${res.status}`); return; }
      const json: any = await res.json();
      const races: TvgResults[] = json.data?.races ?? [];
      const byId = new Map(races.map(r => [`TVG-${r.id}`, r]));
      // Secondary index for Pick-N grading: lookup by (trackCode, raceNumber)
      // since leg races are referenced by track-local race number, not TVG id.
      const byTrackRace = new Map<string, TvgResults>();
      for (const r of races) byTrackRace.set(`${r.trackCode}-${r.number}`, r);

      // Push every observed final race into RaceResults so same-day strategies
      // (track-bias) have a shared history to query. Idempotent — record()
      // skips keys that already exist. Also stamp finish + real payoffs onto
      // the persisted runner snapshots (the calibration training set).
      purgeUnstampedSnapshots();
      for (const r of races) {
        const isFinal = ["RO", "MO"].includes(r.status?.code ?? "");
        if (!isFinal) continue;
        const runners = r.results?.runners ?? [];
        if (runners.length) stampSnapshotResults(`TVG-${r.id}`, runners);
        const finishers = runners
          .filter(rn => rn.finishPosition && rn.finishPosition <= 4)
          .sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99))
          .map(rn => String(rn.biNumber));
        if (!finishers.length) continue;
        // Field size = runners that actually finished or were officially DNF'd
        // (scratches don't have a finishStatus). This is what track-bias needs
        // for post-tier math, not the entry count from the live feed.
        const fieldSize = runners.filter(rn => rn.finishStatus).length || runners.length;
        RaceResults.record({
          trackCode: r.trackCode,
          raceNumber: Number(r.number),
          surface: r.surface?.name ?? "Unknown",
          distance: r.distance ?? "",
          winnerProgram: finishers[0],
          finishOrder: finishers,
          fieldSize,
        });
      }

      if (!open.length) return;
      let unsettledStatuses = "";
      for (const t of open) {
        if (PICKN_TYPES.has(t.type)) {
          this.settlePickN(t, byTrackRace);
          continue;
        }
        const r = byId.get(t.raceId);
        if (!r) { unsettledStatuses += ` ${t.raceId}=NOT_FOUND`; continue; }
        const status = r.status?.code ?? "?";
        const isFinal = ["RO", "MO"].includes(status);
        if (!isFinal) { unsettledStatuses += ` ${t.raceId}=${status}`; continue; }
        const runners = r.results?.runners ?? [];
        if (!runners.length || !runners.some(rn => rn.finishPosition)) {
          unsettledStatuses += ` ${t.raceId}=${status}(no_finish)`;
          continue;
        }
        this.settle(t, r, runners);
      }
      if (unsettledStatuses) {
        this.note(`check ${open.length} open:${unsettledStatuses}`);
      }
    } catch (e) {
      this.note("fetch error " + (e as Error).message);
    }
  }

  // Voids open tickets whose race has been off for longer than STALE_OPEN_MS.
  // Two failure modes drive this:
  //   1. Non-TVG providers (RA-*, HKJC-*) — the TVG settle loop never sees
  //      these tickets, so without this sweep they live forever.
  //   2. TVG races that finish but disappear from the live-races feed before
  //      the grader catches the "RO/MO" status — settle silently bails on
  //      every subsequent tick and the ticket sits open.
  // Void (not lost) is the honest choice: we don't know the outcome and won't
  // pretend we do. Analytics excludes void from realizedPL/ROI sums.
  private sweepStaleOpen() {
    const now = Date.now();
    const cutoff = now - STALE_OPEN_MS;
    const stale = Tickets.list().filter(t =>
      t.status === "open" && (t.postTime ?? t.placedAt) < cutoff,
    );
    if (!stale.length) return;
    for (const t of stale) {
      const ageH = ((now - (t.postTime ?? t.placedAt)) / 3_600_000).toFixed(1);
      const source = t.raceId.startsWith("TVG-") ? "TVG feed dropped race"
        : "no result feed for this provider";
      Tickets.update(t.id, {
        status: "void",
        abortedAt: now,
        abortReason: `stale open ${ageH}h past post — ${source}`,
        realizedPL: 0,
      });
      this.note(
        `[${t.strategyId ?? "?"}] VOID ${t.raceId} ${t.type} #${t.selections.join("-")} ` +
        `· ${ageH}h past post · ${source}`,
      );
    }
  }

  private settle(ticket: Ticket, race: TvgResults, runners: TvgResultRunner[]) {
    const t = Tickets.byId(ticket.id);
    if (!t || t.status !== "open") return;
    const selected = t.selections[0];
    const myFinish = runners.find(rn => String(rn.biNumber) === String(selected));
    const finishOrder = runners
      .filter(rn => rn.finishPosition && rn.finishPosition <= 4)
      .sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99))
      .map(rn => String(rn.biNumber));

    // Scratch handling. WIN/PLACE/SHOW: if our horse didn't run, refund the
    // stake (void, realizedPL 0). EXACTA/TRIFECTA box: if ANY selected horse
    // was scratched, refund — matches standard track rules for boxed tickets.
    const scratchedSelections = t.selections.filter(sel =>
      isScratched(runners.find(rn => String(rn.biNumber) === String(sel))),
    );
    const single = t.type === "WIN" || t.type === "PLACE" || t.type === "SHOW";
    const exoticBox = t.type === "EXACTA" || t.type === "TRIFECTA";
    if ((single && scratchedSelections.length > 0)
        || (exoticBox && scratchedSelections.length > 0)) {
      Tickets.update(t.id, {
        status: "void",
        settledAt: Date.now(),
        realizedPL: 0,
        winners: finishOrder,
        abortReason: `scratched #${scratchedSelections.join(",#")}`,
      });
      const tag = t.strategyId ? `[${t.strategyId}] ` : "";
      const pickLabel = t.selections.length > 1 ? t.selections.map(s => `#${s}`).join("-") : `#${selected}`;
      this.note(
        `${tag}VOID ${t.raceId} ${t.type} ${pickLabel} · scratched (#${scratchedSelections.join(",#")}) · refund $${t.stake.toFixed(2)}`,
      );
      return;
    }

    // Shadow tickets carry stake 0 (bankroll dedup) but settle hypothetically
    // at the stake the strategy would have bet, recorded in shadowPL so
    // overlapping-pick strategies stay measurable. Real realizedPL stays 0.
    const stakeForPayout = t.shadow ? (t.shadowStake ?? 0) : t.stake;
    let won = false, payout = 0;
    let payoutSource: Ticket["payoutSource"];
    if (t.type === "WIN") {
      if (myFinish?.finishPosition === 1 && myFinish.winPayoff && myFinish.betAmount) {
        won = true;
        // TVG payoff is per `betAmount` (usually $2). Scale to our stake.
        payout = (stakeForPayout / myFinish.betAmount) * myFinish.winPayoff;
        payoutSource = "tote";
      }
    } else if (t.type === "PLACE") {
      // Place pays if horse finishes 1st OR 2nd.
      if (myFinish?.finishPosition && myFinish.finishPosition <= 2
          && myFinish.placePayoff && myFinish.betAmount) {
        won = true;
        payout = (stakeForPayout / myFinish.betAmount) * myFinish.placePayoff;
        payoutSource = "tote";
      }
    } else if (t.type === "SHOW") {
      // Show pays if horse finishes 1st, 2nd, OR 3rd.
      if (myFinish?.finishPosition && myFinish.finishPosition <= 3
          && myFinish.showPayoff && myFinish.betAmount) {
        won = true;
        payout = (stakeForPayout / myFinish.betAmount) * myFinish.showPayoff;
        payoutSource = "tote";
      }
    } else if (t.type === "EXACTA" || t.type === "TRIFECTA") {
      // Box settlement. Hit = top-N actual finishers are all members of our
      // selections set, in any order. Payout comes from the race's real tote
      // payoff (results.payoffs) scaled to our per-combo stake; if the feed
      // doesn't expose one, fall back to the book-time estimate and mark the
      // ticket payoutSource = "estimated" so analytics can quarantine it.
      const need = t.type === "EXACTA" ? 2 : 3;
      const top = finishOrder.slice(0, need);
      const coveredSet = new Set(t.selections);
      const hit = top.length === need && top.every(p => coveredSet.has(p));
      if (hit) {
        won = true;
        // Box combos = permutations of the selections; each carries an equal
        // slice of the stake. 2-horse exacta box = 2, 3-horse trifecta box = 6.
        const combos = t.type === "EXACTA" ? 2 : 6;
        const perCombo = stakeForPayout / combos;
        const real = realPayout(
          race, PAYOFF_CODE[t.type]!, perCombo,
          combo => combo.length === need && combo.every(p => coveredSet.has(p)),
        );
        if (real != null && real > 0) {
          payout = real;
          payoutSource = "tote";
        } else {
          payout = t.potentialPayout > 0 ? t.potentialPayout : stakeForPayout;
          payoutSource = "estimated";
        }
      }
    }
    const plAtStake = won ? payout - stakeForPayout : -stakeForPayout;
    const realizedPL = t.shadow ? 0 : plAtStake;
    const closingOdds = Closing.oddsFor(t.raceId, selected);
    // Closing EV grades the bet WE locked in, not a hypothetical bet at the
    // closing price. Scale captured EV by the odds drift — this holds the
    // model's fire-time true probability constant and re-prices at the
    // closing payout. Matches paper-grading intuition: odds drifting OUT
    // (longer) on the same horse makes our bet MORE valuable, not less.
    //
    // The race-off snapshot evaluates EV at closing odds + closing market
    // implied probability, which on bombs (decimal >= 60 in tvg.ts) collapses
    // to pure market and reads as ~-takeout regardless of our captured price.
    // We use that snapshot only as a fallback when capturedOdds is missing.
    // Base off the strategy-calibrated capturedEV so closing EV stays on the
    // same probability model as the "was" label the UI shows; using
    // capturedEVRaw (the adapter's 65%-weight blend) made tvg-baseline rows
    // read ~2× higher than the calibrated fire EV even when odds hadn't moved.
    // WIN closing EV = scaled from captured (constant-trueP). PLACE closing
    // EV = re-run Dr.Z formula against closing pool composition, snapshotted
    // pre-off. The scaling trick doesn't work for PLACE — closing PLACE EV
    // depends on the full pool composition, not just this horse's odds.
    let closingEV: number | undefined;
    if (t.type === "PLACE") {
      closingEV = Closing.placeEvFor(t.raceId, selected);
    } else {
      closingEV = deriveClosingEV({
        type: t.type,
        capturedEV: t.capturedEV,
        capturedOdds: t.capturedOdds,
        closingOdds,
      }) ?? Closing.evFor(t.raceId, selected);
    }
    // Raw mirror — same formula, kept for back-compat with rows that
    // distinguished raw vs capped before the cap was removed.
    const closingEVRaw = t.type === "PLACE"
      ? closingEV
      : deriveClosingEV({
          type: t.type,
          capturedEV: t.capturedEV,
          capturedOdds: t.capturedOdds,
          closingOdds,
        }) ?? Closing.evRawFor(t.raceId, selected);

    Tickets.update(t.id, {
      status: won ? "won" : "lost",
      settledAt: Date.now(),
      realizedPL,
      ...(t.shadow ? { shadowPL: plAtStake } : {}),
      winners: finishOrder,
      closingOdds,
      closingEV,
      closingEVRaw,
      ...(won ? { payoutSource } : {}),
    });

    const tag = t.strategyId ? `[${t.strategyId}] ` : "";
    // CLV only meaningful for single-race WIN bets — closing snapshot is WIN-only.
    const clvNote = t.type === "WIN" && closingOdds && t.capturedOdds
      ? ` · CLV ${(((t.capturedOdds - closingOdds) / closingOdds) * 100).toFixed(1)}%`
      : "";
    const pickLabel = t.selections.length > 1 ? t.selections.map(s => `#${s}`).join("-") : `#${selected}`;
    const exoticTag = EXOTIC_IN_RACE_TYPES.has(t.type) && won
      ? (payoutSource === "tote" ? " (real tote)" : " (est, paper)")
      : "";
    this.note(
      `${tag}SETTLE ${t.raceId} ${t.type} ${pickLabel} ${won ? "WON" : "lost"}${exoticTag} ` +
      `P/L ${realizedPL >= 0 ? "+" : ""}$${realizedPL.toFixed(2)}${clvNote}  finish: ${finishOrder.join("-")}`,
    );
  }

  // Pick-N settle: waits until every leg race is final, then checks each leg's
  // winner against the selections. Payout is taken from the ticket's
  // potentialPayout (estimated at booking time from hit-probability + carryover
  // fraction). TVG's results feed doesn't expose Pick-N pool payouts per
  // ticket, and we can't recover them precisely without the total winning
  // ticket count — paper P/L is directional, not bookable-precise.
  private settlePickN(ticket: Ticket, byTrackRace: Map<string, TvgResults>) {
    const t = Tickets.byId(ticket.id);
    if (!t || t.status !== "open") return;
    if (!t.legs?.length || !t.trackCode) return;

    // Gather each leg's race result. If any leg isn't final or missing from
    // the feed, defer until next tick. Also detect scratches: if every horse
    // we selected on a leg was scratched, the leg is unplayable and the whole
    // ticket refunds (standard multi-race rule — track will substitute the
    // post-time favorite, which our paper P/L doesn't model, so honest thing
    // is to void rather than fabricate a substitution outcome).
    type LegOutcome = { raceNumber: number; winner: string | null; final: boolean };
    const outcomes: LegOutcome[] = [];
    const scratchedLegs: number[] = [];
    for (const leg of t.legs) {
      const race = byTrackRace.get(`${t.trackCode}-${leg.raceNumber}`);
      if (!race) return;     // not yet in feed; try again later
      const final = ["RO", "MO"].includes(race.status?.code ?? "");
      if (!final) return;
      const runners = race.results?.runners ?? [];
      const winner = runners.find(r => r.finishPosition === 1);
      if (!winner) return;   // result not fully posted yet
      const liveSelections = leg.selections.filter(sel =>
        !isScratched(runners.find(rn => String(rn.biNumber) === String(sel))),
      );
      if (liveSelections.length === 0) scratchedLegs.push(leg.raceNumber);
      outcomes.push({ raceNumber: leg.raceNumber, winner: String(winner.biNumber), final: true });
    }

    if (scratchedLegs.length > 0) {
      Tickets.update(t.id, {
        status: "void",
        settledAt: Date.now(),
        realizedPL: 0,
        winners: outcomes.map(o => o.winner!),
        abortReason: `all picks scratched on leg(s) ${scratchedLegs.map(n => `R${n}`).join(",")}`,
      });
      this.note(
        `[${t.strategyId ?? "manual"}] VOID ${t.trackCode} ${t.type} R${t.raceNumber} · ` +
        `all picks scratched on ${scratchedLegs.map(n => `R${n}`).join(",")} · refund $${t.stake.toFixed(2)}`,
      );
      return;
    }

    // Hit every leg?
    const hits = t.legs.map((leg, i) => leg.selections.includes(outcomes[i].winner!));
    const won = hits.every(Boolean);
    // Real tote payout: multi-race payoffs post on the LAST leg's race
    // results. Scale to our per-combo stake (caveman tickets spread the total
    // stake evenly across combos; exactly one combo can hit). Falls back to
    // the book-time estimate when the feed exposes no payoff (or for J6,
    // which has no mapped payoff code).
    const stakeForPayout = t.shadow ? (t.shadowStake ?? 0) : t.stake;
    let payout = 0;
    let payoutSource: Ticket["payoutSource"];
    if (won) {
      const legs = t.legs;
      const lastLeg = legs[legs.length - 1];
      const lastRace = byTrackRace.get(`${t.trackCode}-${lastLeg.raceNumber}`);
      const code = PAYOFF_CODE[t.type];
      const combos = legs.reduce((a, l) => a * Math.max(1, l.selections.length), 1);
      const perCombo = stakeForPayout / combos;
      const real = lastRace && code
        ? realPayout(
            lastRace, code, perCombo,
            combo => combo.length === legs.length
              && combo.every((p, i) => legs[i].selections.includes(p)),
          )
        : null;
      if (real != null && real > 0) {
        payout = real;
        payoutSource = "tote";
      } else {
        payout = t.potentialPayout;
        payoutSource = "estimated";
      }
    }
    const plAtStake = won ? payout - stakeForPayout : -stakeForPayout;
    const realizedPL = t.shadow ? 0 : plAtStake;
    const winnersFlat = outcomes.map(o => o.winner!).join("-");

    Tickets.update(t.id, {
      status: won ? "won" : "lost",
      settledAt: Date.now(),
      realizedPL,
      ...(t.shadow ? { shadowPL: plAtStake } : {}),
      winners: outcomes.map(o => o.winner!),
      ...(won ? { payoutSource } : {}),
    });

    this.note(
      `[${t.strategyId ?? "manual"}] SETTLE ${t.trackCode} ${t.type} R${t.raceNumber} ` +
      `${won ? "WON" : "lost"} hits ${hits.map(h => h ? "✓" : "✗").join("")} ` +
      `winners ${winnersFlat} · P/L ${realizedPL >= 0 ? "+" : ""}$${realizedPL.toFixed(2)} ` +
      `${won ? (payoutSource === "tote" ? "(real tote)" : "(est, paper)") : "(paper)"}`,
    );
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __toteflowGrader: Grader | undefined;
}
// HMR-safe: replace cached instance if it's missing newly-added methods, or
// if its version marker predates the current settle logic.
const cachedGrader = globalThis.__toteflowGrader;
const graderStale = !!cachedGrader && (
  typeof (cachedGrader as any).settlePickN !== "function" ||
  typeof (cachedGrader as any).sweepStaleOpen !== "function" ||
  ((cachedGrader as any).version ?? 0) < 6
);
export const grader = (cachedGrader && !graderStale)
  ? cachedGrader
  : (globalThis.__toteflowGrader = new Grader());
grader.start();
