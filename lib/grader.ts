// Server-side results-grader. Polls TVG for finished races, settles open
// tickets, computes realized P/L and closing-line value (CLV). Also pushes
// every observed final race into RaceResults so same-day strategies (like
// track-bias) have a shared history to query.
import { Tickets, Closing, deriveClosingEV } from "./storage";
import { RaceResults } from "./race-results";
import type { Ticket } from "./types";

const ENDPOINT = "https://service.tvg.com/graph/v2/query";

const RESULTS_QUERY = `{
  races {
    id number trackCode distance
    surface { name }
    status { code name }
    results {
      runners { biNumber finishPosition winPayoff placePayoff showPayoff betAmount finishStatus }
    }
  }
}`;

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

// Any open ticket more than this many ms past its postTime gets voided by the
// janitor pass. Bounds the live-opportunities panel and recovers the staked
// dollars from analytics' ROI denominator. Set generously to cover the
// last-leg-plus-results window for Pick-N (worst case ~3h between first and
// last leg, plus result-posting lag).
const STALE_OPEN_MS = 4 * 60 * 60_000;

class Grader {
  // Marker bumped whenever settle logic adds new ticket types — read by the
  // HMR staleness check below so dev reloads pick up the new settle paths.
  readonly version = 3;
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
      // skips keys that already exist.
      for (const r of races) {
        const isFinal = ["RO", "MO"].includes(r.status?.code ?? "");
        if (!isFinal) continue;
        const runners = r.results?.runners ?? [];
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
        this.settle(t, runners);
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

  private settle(ticket: Ticket, runners: TvgResultRunner[]) {
    const t = Tickets.byId(ticket.id);
    if (!t || t.status !== "open") return;
    const selected = t.selections[0];
    const myFinish = runners.find(rn => String(rn.biNumber) === String(selected));
    const finishOrder = runners
      .filter(rn => rn.finishPosition && rn.finishPosition <= 4)
      .sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99))
      .map(rn => String(rn.biNumber));

    let won = false, payout = 0;
    if (t.type === "WIN") {
      if (myFinish?.finishPosition === 1 && myFinish.winPayoff && myFinish.betAmount) {
        won = true;
        // TVG payoff is per `betAmount` (usually $2). Scale to our stake.
        payout = (t.stake / myFinish.betAmount) * myFinish.winPayoff;
      }
    } else if (t.type === "PLACE") {
      // Place pays if horse finishes 1st OR 2nd.
      if (myFinish?.finishPosition && myFinish.finishPosition <= 2
          && myFinish.placePayoff && myFinish.betAmount) {
        won = true;
        payout = (t.stake / myFinish.betAmount) * myFinish.placePayoff;
      }
    } else if (t.type === "SHOW") {
      // Show pays if horse finishes 1st, 2nd, OR 3rd.
      if (myFinish?.finishPosition && myFinish.finishPosition <= 3
          && myFinish.showPayoff && myFinish.betAmount) {
        won = true;
        payout = (t.stake / myFinish.betAmount) * myFinish.showPayoff;
      }
    } else if (t.type === "EXACTA" || t.type === "TRIFECTA") {
      // Box settlement. Hit = top-N actual finishers are all members of our
      // selections set, in any order. Payout from TVG's per-runner results
      // feed isn't available for exotic pools (only WIN/PLACE/SHOW payoffs
      // are exposed), so we fall back to the estimatedPayout captured at book
      // time. Same caveat as Pick-N: paper P/L is directional, not bookable-
      // precise.
      const need = t.type === "EXACTA" ? 2 : 3;
      const top = finishOrder.slice(0, need);
      const coveredSet = new Set(t.selections);
      const hit = top.length === need && top.every(p => coveredSet.has(p));
      if (hit) {
        won = true;
        payout = t.potentialPayout > 0 ? t.potentialPayout : t.stake;
      }
    }
    const realizedPL = won ? payout - t.stake : -t.stake;
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
    const closingEV = deriveClosingEV({
      type: t.type,
      capturedEV: t.capturedEV,
      capturedOdds: t.capturedOdds,
      closingOdds,
    }) ?? Closing.evFor(t.raceId, selected);
    // Raw mirror — same formula, kept for back-compat with rows that
    // distinguished raw vs capped before the cap was removed.
    const closingEVRaw = deriveClosingEV({
      type: t.type,
      capturedEV: t.capturedEV,
      capturedOdds: t.capturedOdds,
      closingOdds,
    }) ?? Closing.evRawFor(t.raceId, selected);

    Tickets.update(t.id, {
      status: won ? "won" : "lost",
      settledAt: Date.now(),
      realizedPL,
      winners: finishOrder,
      closingOdds,
      closingEV,
      closingEVRaw,
    });

    const tag = t.strategyId ? `[${t.strategyId}] ` : "";
    // CLV only meaningful for single-race WIN bets — closing snapshot is WIN-only.
    const clvNote = t.type === "WIN" && closingOdds && t.capturedOdds
      ? ` · CLV ${(((t.capturedOdds - closingOdds) / closingOdds) * 100).toFixed(1)}%`
      : "";
    const pickLabel = t.selections.length > 1 ? t.selections.map(s => `#${s}`).join("-") : `#${selected}`;
    const exoticTag = EXOTIC_IN_RACE_TYPES.has(t.type) && won ? " (est, paper)" : "";
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
    // the feed, defer until next tick.
    type LegOutcome = { raceNumber: number; winner: string | null; final: boolean };
    const outcomes: LegOutcome[] = [];
    for (const leg of t.legs) {
      const race = byTrackRace.get(`${t.trackCode}-${leg.raceNumber}`);
      if (!race) return;     // not yet in feed; try again later
      const final = ["RO", "MO"].includes(race.status?.code ?? "");
      if (!final) return;
      const runners = race.results?.runners ?? [];
      const winner = runners.find(r => r.finishPosition === 1);
      if (!winner) return;   // result not fully posted yet
      outcomes.push({ raceNumber: leg.raceNumber, winner: String(winner.biNumber), final: true });
    }

    // Hit every leg?
    const hits = t.legs.map((leg, i) => leg.selections.includes(outcomes[i].winner!));
    const won = hits.every(Boolean);
    const payout = won ? t.potentialPayout : 0;
    const realizedPL = won ? payout - t.stake : -t.stake;
    const winnersFlat = outcomes.map(o => o.winner!).join("-");

    Tickets.update(t.id, {
      status: won ? "won" : "lost",
      settledAt: Date.now(),
      realizedPL,
      winners: outcomes.map(o => o.winner!),
    });

    this.note(
      `[${t.strategyId ?? "manual"}] SETTLE ${t.trackCode} ${t.type} R${t.raceNumber} ` +
      `${won ? "WON" : "lost"} hits ${hits.map(h => h ? "✓" : "✗").join("")} ` +
      `winners ${winnersFlat} · P/L ${realizedPL >= 0 ? "+" : ""}$${realizedPL.toFixed(2)} ` +
      `(est, paper)`,
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
  ((cachedGrader as any).version ?? 0) < 3
);
export const grader = (cachedGrader && !graderStale)
  ? cachedGrader
  : (globalThis.__toteflowGrader = new Grader());
grader.start();
