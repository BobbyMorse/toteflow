// Server-side auto-booker. Polls live providers, runs each enabled strategy
// against every race, and STAGES paper tickets when a strategy's threshold
// is met. A staged ticket is a held opportunity, not a placed bet — it carries
// no stake and no captured odds yet. On each subsequent tick the engine
// re-evaluates every staged ticket via the optimal-timer:
//   - BET_NOW / LOCKED → promote: capture live odds + EV, commit real stake,
//                                  set placedAt = now (this is the moment a
//                                  human would have clicked the CTA)
//   - ABORT             → mark aborted (live EV went negative; do not bet)
//   - MISSED            → mark aborted (post passed before fire signal)
//   - WAIT              → leave staged, try again next tick
// This way paper P/L reflects the odds a human would actually have gotten,
// not the favorable mid-discovery snapshot that originally tripped the
// strategy. Settlement is unchanged — grader uses real tote payouts.
// Pick-N tickets keep the legacy one-shot book flow (different lifecycle,
// no per-runner live odds to monitor).
import { liveProviders } from "./adapters";
import { Tickets, AutoBook, Closing } from "./storage";
import { strategies } from "./strategies";
import { computePlaceEVs } from "./strategies/dr-z-place";
import type { Race, Ticket } from "./types";
import type { Strategy, StrategyConfig, StrategyEvaluation } from "./strategies/types";
import { detectCarryovers, type CarryoverOpportunity } from "./carryovers";
import { decideBetWindow } from "./optimal-timer";
import { minBaseForWager } from "./wager-minimums";
import { strategyCalibratedTrueP } from "./strategy-calibration";
import { strategyAppliesToTrack } from "./track-types";

function phaseOf(race: Race, now: number): Race["phase"] {
  const ms = race.postTime - now;
  // Extended chaos: while scheduled post has passed but the race is still IC
  // (drag — pool open, horses haven't left the gate), keep the race in chaos
  // so strategies keep evaluating. Late-steam opportunities in the drag
  // window often only appear here; if we call "off" the moment scheduled T
  // passes, we never see them. Cap at -120s so a race whose feed goes stale
  // doesn't trap us in permanent chaos.
  const raceIsOff = race.statusCode === "SK";
  const isBettableStatus = !race.statusCode || race.statusCode === "IC" || race.statusCode === "O";
  return ms > 15 * 60_000 ? "scheduled"
    : ms > 5 * 60_000     ? "discovery"
    : ms > 60_000         ? "action"
    : ms > 0              ? "chaos"
    : (!raceIsOff && isBettableStatus && ms > -120_000) ? "chaos"
    : "off";
}

function phaseAllowed(setting: StrategyConfig["fireAtPhase"], phase: Race["phase"]): boolean {
  if (setting === "discovery") return phase === "discovery" || phase === "action" || phase === "chaos";
  if (setting === "action")    return phase === "action"    || phase === "chaos";
  return phase === "chaos";
}

// Carryover Pick-N opportunities run alongside the per-race strategy loop.
// We always log alerts (deduplicated by (track,wagerType,startTime)); on top
// of that, if the `carryover-pickn` strategy config is enabled and the gates
// pass, we also book a paper caveman ticket via `bookCarryoverTicket`.
interface CarryoverAlert extends CarryoverOpportunity {
  detectedAt: number;
  key: string;
}

const CARRYOVER_STRATEGY_ID = "carryover-pickn";
const MAX_PICKN_TICKET_COST = 10;       // hard cap; shrinks spread if exceeded
const PICKN_FIRE_BUFFER_MS = 5 * 60_000; // need ≥5 min to first-leg post

class Engine {
  started = false;
  lastTick = 0;
  inFlight: Promise<void> | null = null;
  // Tightened in tick() based on nearest race's ms-to-post — fast enough that
  // a ticket entering LOCKED at T-2min never has to wait more than a few
  // seconds for the next promote pass.
  private nearestPostMs = Infinity;
  log: { ts: number; msg: string }[] = [];
  carryoverAlerts: CarryoverAlert[] = [];
  // Dedup window: don't re-fire the same carryover alert for 30 minutes —
  // the pool changes slowly and we don't want log spam.
  private seenCarryovers = new Map<string, number>();
  private carryoverDedupMs = 30 * 60_000;
  // Confidence threshold for logging an alert. "medium" or "high" only —
  // "low" detections are noise.
  private carryoverMinConfidence: CarryoverOpportunity["confidence"] = "medium";
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    this.note(`autobook engine started · ${strategies.length} strategies`);
    void this.tickIfDue();
    // Self-scheduled heartbeat — without this, ticks only fire when a browser
    // hits /api/autobook or /api/stream. On Fly the machine stays running
    // (min_machines_running=1, auto_stop=off) but nothing drives the engine
    // when no one's watching, so bets never staged/promoted/settled overnight.
    // 1s cadence is cheap; tickIfDue() gates the actual work by intervalMs
    // (adaptive 2–15s based on nearest race).
    this.heartbeat = setInterval(() => { void this.tickIfDue(); }, 1000);
    if (typeof (this.heartbeat as any)?.unref === "function") (this.heartbeat as any).unref();
  }

  // Adaptive cadence keyed to the closest race. Mirrors the SSE stream's own
  // pacing so promote passes happen as fast as polls do near post — otherwise
  // a 15s gate would miss the LOCKED window (T-2min → 0) when the tick
  // happens to land just after post.
  get intervalMs(): number {
    if (this.nearestPostMs <= 60_000) return 2_000;       // chaos: every 2s
    if (this.nearestPostMs <= 5 * 60_000) return 4_000;   // action: every 4s
    return 15_000;                                        // discovery/idle
  }

  async tickIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTick < this.intervalMs) return;
    if (this.inFlight) return this.inFlight;
    this.lastTick = now;
    this.inFlight = this.tick().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private note(msg: string) {
    this.log.push({ ts: Date.now(), msg });
    if (this.log.length > 200) this.log.shift();
  }
  recentLog(n = 50) { return this.log.slice(-n).reverse(); }

  private async tick() {
    if (!AutoBook.globalEnabled()) return;
    let races: Race[] = [];
    try {
      const results = await Promise.all(liveProviders().map(p => p.listRaces()));
      races = results.flat();
    } catch (e) { this.note("fetch error " + (e as Error).message); return; }

    const now = Date.now();

    // Update adaptive cadence for the next tickIfDue check.
    let nearest = Infinity;
    for (const r of races) {
      const ms = r.postTime - now;
      if (ms > 0 && ms < nearest) nearest = ms;
    }
    this.nearestPostMs = nearest;

    const evalCount: Record<string, { evaluated: number; matched: number; belowThreshold: number; staged: number; pivoted: number; refreshed: number }> = {};
    for (const s of strategies) evalCount[s.id] = { evaluated: 0, matched: 0, belowThreshold: 0, staged: 0, pivoted: 0, refreshed: 0 };

    for (const r of races) {
      this.snapshotOdds(r);
      for (const s of strategies) {
        const result = this.considerStrategy(s, r, now);
        evalCount[s.id].evaluated++;
        if (result === "staged") evalCount[s.id].staged++;
        else if (result === "pivoted") evalCount[s.id].pivoted++;
        else if (result === "refreshed") evalCount[s.id].refreshed++;
        else if (result === "below-threshold") evalCount[s.id].belowThreshold++;
        else if (result === "matched") evalCount[s.id].matched++;
      }
    }

    // Cross-race pass: strategies that span multiple races (DD, sequential
    // overlays, etc.) get the full race set in one shot. They emit multi-leg
    // evaluations which book directly like Pick-N — no per-leg optimal-timer
    // staging, because a multi-race ticket commits all legs at once.
    for (const s of strategies) {
      if (typeof s.evaluateCrossRace !== "function") continue;
      const cfg = AutoBook.strategyConfig(s.id);
      if (!cfg || !cfg.enabled) continue;
      // Only expose races in disciplines this strategy handles — same reason as
      // the per-race discipline gate above. A thoroughbred DD strategy should
      // never see harness races when scanning for leg pairs.
      const eligible = races.filter(r => strategyAppliesToTrack(s.appliesTo, r.trackType));
      if (eligible.length === 0) continue;
      let evals: StrategyEvaluation[] = [];
      try { evals = s.evaluateCrossRace(eligible) ?? []; }
      catch (e) { this.note(`${s.id} cross-race eval error: ${(e as Error).message}`); continue; }
      for (const ev of evals) {
        if (ev.evPercent < cfg.evThreshold) continue;
        this.bookMultiLegTicket(s.id, cfg, ev, now);
      }
    }

    // Index live races by id once, then walk every staged ticket and decide
    // whether to promote, abort, or keep holding. This is the core of the
    // human-mirroring lifecycle.
    const racesById = new Map(races.map(r => [r.id, r]));
    const promo = this.promoteStagedTickets(racesById, now);

    const summary = strategies
      .map(s => {
        const c = evalCount[s.id];
        return `${s.id}=${c.staged}s${c.pivoted ? `/${c.pivoted}p` : ""}${c.refreshed ? `/${c.refreshed}r` : ""}`;
      })
      .filter(s => !s.endsWith("=0s"))
      .join(" ");
    this.note(`tick: ${races.length} races${summary ? ` · ${summary}` : ""} · promoted=${promo.promoted} aborted=${promo.aborted}`);

    await this.scanCarryovers();
  }

  // Walk every staged ticket and let the optimal-timer decide its fate. Called
  // each tick. Returns aggregate counters for the tick log.
  private promoteStagedTickets(racesById: Map<string, Race>, now: number): { promoted: number; aborted: number } {
    let promoted = 0, aborted = 0;
    const staged = Tickets.list().filter(t => t.status === "staged");
    for (const t of staged) {
      const race = racesById.get(t.raceId);
      const selection = t.selections[0];
      const runner = race?.runners.find(r => r.program === selection) ?? null;
      const msToPost = (t.postTime ?? race?.postTime ?? 0) - now;

      // Post passed without the timer ever giving us a fire signal — log as
      // missed window. This is a strategy quality signal: too tight or too
      // early to ever clear the optimal-timer.
      if (msToPost <= 0) {
        Tickets.update(t.id, {
          status: "aborted",
          abortedAt: now,
          abortReason: "missed window — post passed before fire signal",
        });
        aborted++;
        this.note(`[${t.strategyId ?? "?"}] ABORT ${t.raceId} #${selection} · missed window`);
        continue;
      }

      // Race feed dropped or runner scratched — abort. We can't honestly
      // simulate placing a bet we wouldn't have live odds for.
      if (!race || !runner || runner.scratched) {
        Tickets.update(t.id, {
          status: "aborted",
          abortedAt: now,
          abortReason: !runner ? "runner missing from feed" : runner.scratched ? "runner scratched" : "race missing from feed",
        });
        aborted++;
        this.note(`[${t.strategyId ?? "?"}] ABORT ${t.raceId} #${selection} · ${runner?.scratched ? "scratched" : "no live data"}`);
        continue;
      }

      // In-race exotic wagers (EXACTA/TRIFECTA) skip the EV-based abort. Their
      // edge thesis is measured against the exotic pool, not the key horse's
      // WIN-pool EV, so a drift in the key horse's WIN EV isn't a reason to
      // cancel an exacta. We still use the timer to pick a fire moment, but
      // ABORT decisions only fire on hard errors (window passed, scratch),
      // which are handled above.
      const isExoticInRace = t.type === "EXACTA" || t.type === "TRIFECTA";
      const decision = decideBetWindow({ race, runner, msToPost });
      if (decision.status === "ABORT" && !isExoticInRace) {
        Tickets.update(t.id, {
          status: "aborted",
          abortedAt: now,
          abortReason: decision.detail,
        });
        aborted++;
        this.note(`[${t.strategyId ?? "?"}] ABORT ${t.raceId} #${selection} · ${decision.detail}`);
        continue;
      }
      if (decision.status !== "BET_NOW" && decision.status !== "LOCKED") {
        continue; // still WAIT/STALE — hold for next tick
      }

      // Promote: capture live odds + live EV at this moment. Re-check shadow
      // status at promotion time, because another strategy may have promoted
      // a real bet on this same selection since we staged.
      const cfg = AutoBook.strategyConfig(t.strategyId ?? "");
      const isShadow = Tickets.hasRealBet(t.raceId, t.type, t.selections);
      const liveOdds = runner.currentOdds;
      // Re-evaluate the originating strategy so capturedEV reflects the
      // strategy's own calibration at fire-time odds, not the adapter's raw
      // model blend. runner.evPercent is the adapter's blend (e.g.
      // MODEL_WEIGHT=0.65 for TVG "high" quality); strategies like
      // tvg-baseline explicitly recalibrate to a lower weight because the raw
      // blend is overconfident. Using runner.evPercent here produced ticket
      // rows showing +60% when the strategy's reason string said +20%.
      const originStrategy = strategies.find(s => s.id === t.strategyId) ?? null;
      let calibratedEv: number | null = null;
      let calibratedReason: string | null = null;
      let calibratedTrueP: number | null = null;
      if (originStrategy) {
        try {
          const reeval = originStrategy.evaluate(race);
          if (reeval && reeval.selection === selection && reeval.type === t.type) {
            calibratedEv = reeval.evPercent;
            calibratedReason = reeval.reason;
            calibratedTrueP = reeval.truePWin ?? null;
          }
        } catch (e) {
          this.note(`${originStrategy.id} re-eval error on ${race.id}: ${(e as Error).message}`);
        }
      }
      // Fall back to the staged (strategy-calibrated) EV if the strategy
      // no longer matches — never fall back to runner.evPercent, which is
      // the uncalibrated adapter value we're specifically avoiding.
      const liveEv = calibratedEv ?? t.capturedEV;
      const liveEvRaw = runner.evPercentRaw;
      // Same story for trueP: prefer the strategy's own calibrated value
      // (from its evaluate() output), else derive it from the runner's
      // adapter blend using the strategy's known calibration, else fall
      // through to the adapter's blend unchanged.
      const liveMarketP = 1 / Math.max(1.2, liveOdds);
      const liveTrueP = calibratedTrueP
        ?? (runner.truePWin != null
              ? strategyCalibratedTrueP(t.strategyId, runner.truePWin, liveMarketP)
              : undefined);

      if (isExoticInRace) {
        // Preserve the stake and estimatedPayout that were locked in at stage
        // time — those reflect the strategy's exotic-pool math. capturedOdds
        // stores the key horse's live WIN odds for provenance only (so the
        // UI can show what the chalk looked like at fire time).
        const stagedStake = t.stake;
        const liveStake = isShadow ? 0 : stagedStake;
        Tickets.update(t.id, {
          status: "open",
          stake: liveStake,
          capturedOdds: liveOdds,
          // capturedEV stays at the strategy's match-time exotic-pool EV;
          // there's no honest "live EV" for an exacta from per-runner data.
          placedAt: now,
          shadow: isShadow || undefined,
        });
        promoted++;
        this.note(
          `[${t.strategyId ?? "?"}] ${isShadow ? "SHADOW " : ""}FIRE ${t.raceId} ${t.type} #${t.selections.join("-")} ` +
          `key @ ${runner.fractionalOdds} · stake $${liveStake.toFixed(2)} · est payout $${t.potentialPayout.toFixed(0)} ` +
          `(${decision.status === "LOCKED" ? "T-15s lock" : "EV peaked"})`,
        );
        continue;
      }

      const baseStake = cfg?.stake ?? t.stake ?? 0;
      const liveStake = isShadow ? 0 : baseStake;
      Tickets.update(t.id, {
        status: "open",
        stake: liveStake,
        capturedOdds: liveOdds,
        capturedEV: liveEv,
        capturedEVRaw: liveEvRaw,
        capturedTrueP: liveTrueP,
        potentialPayout: liveStake * liveOdds,
        placedAt: now,
        shadow: isShadow || undefined,
        ...(calibratedReason ? { reason: calibratedReason } : {}),
      });
      promoted++;
      this.note(
        `[${t.strategyId ?? "?"}] ${isShadow ? "SHADOW " : ""}FIRE ${t.raceId} #${selection} ` +
        `@ ${runner.fractionalOdds} live EV ${liveEv >= 0 ? "+" : ""}${liveEv.toFixed(1)}% ` +
        `(${decision.status === "LOCKED" ? "T-15s lock" : "EV peaked"})`,
      );
    }
    return { promoted, aborted };
  }

  private async scanCarryovers() {
    let opps: CarryoverOpportunity[];
    try {
      opps = await detectCarryovers();
    } catch (e) {
      this.note(`carryover scan error ${(e as Error).message}`);
      return;
    }
    const now = Date.now();
    // Purge expired dedup entries
    for (const [k, ts] of this.seenCarryovers) {
      if (now - ts > this.carryoverDedupMs) this.seenCarryovers.delete(k);
    }
    const order = { high: 3, medium: 2, low: 1 } as const;
    const minRank = order[this.carryoverMinConfidence];
    let fresh = 0;
    for (const o of opps) {
      // Always attempt booking — ticket-level dedup inside bookCarryoverTicket
      // handles double-book prevention. This way an opportunity that starts
      // "medium" and later upgrades to "high" (pool grew) still gets booked.
      this.bookCarryoverTicket(o);

      // Alert log dedup is separate from booking — purely for log spam control.
      if (order[o.confidence] < minRank) continue;
      const key = `${o.trackCode}:${o.wagerType}:${Math.floor(o.postTime / 60_000)}`;
      if (this.seenCarryovers.has(key)) continue;
      this.seenCarryovers.set(key, now);
      const alert: CarryoverAlert = { ...o, detectedAt: now, key };
      this.carryoverAlerts.unshift(alert);
      while (this.carryoverAlerts.length > 50) this.carryoverAlerts.pop();
      fresh++;
      this.note(
        `[carryover] ${o.confidence.toUpperCase()} ${o.trackCode} ${o.wagerLabel} ` +
        `pool $${Math.round(o.poolAmount).toLocaleString()} ` +
        `(excess $${Math.round(o.excess).toLocaleString()}, raw +${o.rawEdgePct.toFixed(1)}%)`,
      );
    }
    if (fresh === 0 && opps.length > 0) {
      // We saw opportunities but they were all dedup'd or sub-confidence —
      // emit a single line so the user knows the scanner is awake.
      this.note(`carryover scan: ${opps.length} candidates, 0 new alerts`);
    }
  }

  recentCarryovers(n = 20) { return this.carryoverAlerts.slice(0, n); }

  // Book a paper Pick-N caveman ticket against a carryover opportunity. Returns
  // silently when gates fail — failures are logged so the user can audit.
  private bookCarryoverTicket(o: CarryoverOpportunity) {
    if (!AutoBook.globalEnabled()) return;
    const cfg = AutoBook.strategyConfig(CARRYOVER_STRATEGY_ID);
    if (!cfg || !cfg.enabled) return;

    // Discipline gate — respect the strategy's declared appliesTo. Prevents a
    // future harness carryover strategy from booking against thoroughbred
    // opportunities (and vice-versa).
    const carryoverStrategy = strategies.find(s => s.id === CARRYOVER_STRATEGY_ID);
    if (!carryoverStrategy) return;
    if (!strategyAppliesToTrack(carryoverStrategy.appliesTo, o.trackType)) return;

    // Gates — fail fast and quietly. We already logged the alert above.
    if (o.confidence !== "high") return;
    if (o.rawEdgePct < cfg.evThreshold) return;
    if (o.postTime - Date.now() < PICKN_FIRE_BUFFER_MS) return;
    if (!o.legs.length || o.legs.some(l => l.missing || l.picks.length === 0)) return;
    if (o.legs.some(l => l.modelQuality === "low")) return;

    // Dedup: skip if we've already booked this exact opportunity in the current
    // race window. Pick-N tickets use the start race id as raceId; the (strategy,
    // track, type, raceNumber) tuple uniquely identifies the sequence within a
    // single race day. Limit to staged/open tickets so yesterday's settled
    // Pick-N at the same track + race number doesn't block today's run.
    const dup = Tickets.list().some(t =>
      t.strategyId === CARRYOVER_STRATEGY_ID &&
      t.trackCode === o.trackCode &&
      t.type === (o.wagerType as Ticket["type"]) &&
      t.raceNumber === o.startRaceNumber &&
      (t.status === "staged" || t.status === "open"),
    );
    if (dup) return;

    // Build caveman: top-1 if the leg has a strong overlay (top EV ≥ +10%),
    // else top-2. Strong-overlay singles concentrate stake on conviction picks
    // and drop combo count fast.
    const legSizes = o.legs.map(leg => {
      const top = leg.picks[0];
      if (top && top.evPercent >= 10) return 1;
      return Math.min(2, leg.picks.length);
    });

    // Cost cap: shrink top-2 → top-1 in legs with the smallest EV gap between
    // top-1 and top-2 (we lose the least information dropping those).
    // Base price is the configured stake floored to the wager's actual
    // minimum — the ADW will reject anything below. The TVG feed often
    // reports the legacy per-combo floor (e.g. $0.50) even when the track
    // enforces a higher per-ticket minimum (e.g. CD P3 = $3.00, verified via
    // FanDuel rejection). Take the max of both sources so the verified
    // override in lib/wager-minimums.ts can never be undercut.
    const minBase = Math.max(o.minWagerAmount ?? 0, minBaseForWager(o.trackCode, o.wagerType));
    const basePrice = Math.max(cfg.stake, minBase);
    const bumpedToMin = basePrice > cfg.stake;
    const combos = () => legSizes.reduce((a, b) => a * b, 1);
    const cost = () => combos() * basePrice;
    while (cost() > MAX_PICKN_TICKET_COST) {
      let bestIdx = -1, bestGap = Infinity;
      for (let i = 0; i < o.legs.length; i++) {
        if (legSizes[i] <= 1) continue;
        const gap = (o.legs[i].picks[0]?.evPercent ?? 0) - (o.legs[i].picks[1]?.evPercent ?? 0);
        if (gap < bestGap) { bestGap = gap; bestIdx = i; }
      }
      if (bestIdx < 0) break;
      legSizes[bestIdx] = 1;
    }

    // Estimated payout — combine per-leg hit probabilities, then size against
    // the actual carryover-adjusted pool. The OLD formula used `1/(1-frac)` =
    // `1 + C/N`, which ignored takeout entirely and overstated payout by one
    // takeout (~25% on a 25%-takeout exotic). The honest pool-payout multiplier
    // assuming proportional public betting is `(1 - T) + C/N`:
    //   payout_pool = N*(1-T) + C
    //   per-$1 fair payout if win = (N*(1-T) + C) / (hitProb * N)
    //                             = ((1-T) + C/N) / hitProb
    //   => payout = fairPayout * ((1-T) + C/N)
    // where C = carryover excess, N = new money = poolAmount - excess.
    const legHitProbs = o.legs.map((leg, i) => {
      const covered = leg.picks.slice(0, legSizes[i]);
      const sumP = covered.reduce((a, p) => a + (p.truePWin ?? 0), 0);
      return Math.max(0.02, sumP);     // floor to avoid degenerate division
    });
    const hitProb = legHitProbs.reduce((a, b) => a * b, 1);
    const carryoverFrac = Math.max(0, Math.min(0.95, o.excess / Math.max(1, o.poolAmount)));
    // C/N from carryoverFrac (= C/P): C/N = frac / (1 - frac).
    const cOverN = carryoverFrac / Math.max(0.01, 1 - carryoverFrac);
    const stake = cost();
    const fairPayout = stake / Math.max(0.0001, hitProb);
    const estimatedPayout = fairPayout * ((1 - o.takeoutAssumption) + cOverN);

    const structuredLegs = o.legs.map((leg, i) => ({
      raceNumber: leg.raceNumber,
      selections: leg.picks.slice(0, legSizes[i]).map(p => p.program),
    }));
    const flatSelections = structuredLegs.flatMap(l => l.selections);

    const now = Date.now();
    const ticket: Ticket = {
      id: `auto_${CARRYOVER_STRATEGY_ID}_${now}_${Math.random().toString(36).slice(2, 6)}`,
      raceId: `TVG-${o.trackCode}-${o.startRaceNumber}`,
      trackCode: o.trackCode,
      trackName: o.trackName,
      raceNumber: o.startRaceNumber,
      type: o.wagerType as Ticket["type"],
      selections: flatSelections,
      legs: structuredLegs,
      stake,
      potentialPayout: estimatedPayout,
      capturedEV: o.rawEdgePct,
      capturedOdds: 0,
      placedAt: now,
      postTime: o.postTime,
      status: "open",
      mode: "auto",
      strategyId: CARRYOVER_STRATEGY_ID,
      reason:
        `Caveman ${legSizes.join("×")}=${combos()} combos × $${basePrice.toFixed(2)} ` +
        (bumpedToMin ? `(floored from $${cfg.stake.toFixed(2)} to wager min $${minBase.toFixed(2)}) ` : "") +
        `· carryover excess $${Math.round(o.excess).toLocaleString()} ` +
        `· est edge +${o.rawEdgePct.toFixed(1)}% · est hit ${(hitProb * 100).toFixed(2)}%`,
    };
    Tickets.add(ticket);
    this.note(
      `[${CARRYOVER_STRATEGY_ID}] BOOK ${o.trackCode} ${o.wagerLabel} R${o.startRaceNumber} ` +
      `${legSizes.join("×")}=${combos()} combos · $${stake.toFixed(2)}` +
      (bumpedToMin ? ` (base $${basePrice.toFixed(2)} = wager min, configured $${cfg.stake.toFixed(2)})` : "") +
      ` · est payout $${estimatedPayout.toFixed(0)}`,
    );
  }

  // Book a multi-leg exotic ticket (DD and friends) directly, without going
  // through the stage → optimal-timer → promote dance that single-runner
  // wagers use. Multi-leg tickets commit all legs at once; there's no
  // per-leg fire window to manage, and capturedOdds isn't meaningful (the
  // payout comes from a separate exotic pool, not from leg-1's WIN odds).
  // Mirrors bookCarryoverTicket but for strategy-driven (non-carryover)
  // multi-leg wagers.
  private bookMultiLegTicket(strategyId: string, cfg: StrategyConfig, evaluation: StrategyEvaluation, now: number) {
    const legs = evaluation.legs;
    if (!legs || !legs.length) return;
    const trackCode = evaluation.trackCode ?? "";
    const startRaceNumber = evaluation.startRaceNumber ?? legs[0].raceNumber;
    const postTime = evaluation.postTime ?? now;
    if (!trackCode) return;

    // Dedup: skip if we've already booked this exact opportunity. Match by
    // (strategy, track, type, startRaceNumber) within active tickets so a
    // settled bet from yesterday at the same race number doesn't block today.
    const dup = Tickets.list().some(t =>
      t.strategyId === strategyId &&
      t.trackCode === trackCode &&
      t.type === evaluation.type &&
      t.raceNumber === startRaceNumber &&
      (t.status === "staged" || t.status === "open"),
    );
    if (dup) return;

    // Combos and base price. Default base is the configured stake (per combo).
    // Exotic wagers honor the same wager-minimums table that Pick-N uses; the
    // grader doesn't enforce the minimum so we just respect cfg.stake here.
    const combos = evaluation.combos ?? legs.reduce((a, l) => a * Math.max(1, l.selections.length), 1);
    const basePrice = cfg.stake;
    const stake = combos * basePrice;
    const estimatedPayout = evaluation.estimatedPayout ?? 0;
    const flatSelections = legs.flatMap(l => l.selections);

    const ticket: Ticket = {
      id: `auto_${strategyId}_${now}_${Math.random().toString(36).slice(2, 6)}`,
      raceId: `TVG-${trackCode}-${startRaceNumber}`,
      trackCode,
      raceNumber: startRaceNumber,
      type: evaluation.type,
      selections: flatSelections,
      legs,
      stake,
      potentialPayout: estimatedPayout,
      capturedEV: evaluation.evPercent,
      capturedOdds: 0,
      placedAt: now,
      postTime,
      status: "open",
      mode: "auto",
      strategyId,
      reason: evaluation.reason,
    };
    Tickets.add(ticket);
    this.note(
      `[${strategyId}] BOOK ${trackCode} ${evaluation.type} R${startRaceNumber} ` +
      `${legs.map(l => l.selections.length).join("×")}=${combos} combos · $${stake.toFixed(2)} ` +
      `· est payout $${estimatedPayout.toFixed(0)} · EV +${evaluation.evPercent.toFixed(1)}%`,
    );
  }

  // Pre-off odds snapshot — the latest snapshot before settle becomes the
  // ticket's `closingOdds` (used for CLV) and `closingEV` (the truthful grading
  // metric — model EV at the moment the gates broke). We capture both the
  // capped EV (what strategies see) and the raw model EV (what the model
  // actually thinks) so settled tickets can show the unclipped closing value.
  private snapshotOdds(race: Race) {
    const odds: Record<string, number> = {};
    const ev: Record<string, number> = {};
    const evRaw: Record<string, number> = {};
    for (const rn of race.runners) {
      odds[rn.program] = rn.currentOdds;
      ev[rn.program] = rn.evPercent;
      if (rn.evPercentRaw != null) evRaw[rn.program] = rn.evPercentRaw;
    }
    // PLACE closing EV: run the Dr.Z Ziemba/Hausch calc against the closing
    // pool composition. Empty (returned as undefined) when the race lacks
    // per-runner pool data or place-pool liquidity — PLACE tickets in those
    // races simply won't have a closing EV to grade against, same as WIN
    // bets on races without an odds snapshot.
    const placeEv = computePlaceEVs(race);
    const placeEvOrNone = Object.keys(placeEv).length ? placeEv : undefined;
    Closing.snapshot(race.id, odds, ev, evRaw, placeEvOrNone);
  }

  private considerStrategy(strategy: Strategy, race: Race, now: number): "staged" | "pivoted" | "refreshed" | "matched" | "below-threshold" | "skipped" {
    const cfg = AutoBook.strategyConfig(strategy.id);
    if (!cfg || !cfg.enabled) return "skipped";

    // Discipline gate: strategies declare which breeds they apply to. Keeps
    // thoroughbred strategies from ever being evaluated against harness/QH
    // races (and vice-versa) so per-breed strategy groups stay isolated.
    if (!strategyAppliesToTrack(strategy.appliesTo, race.trackType)) return "skipped";

    const phase = phaseOf(race, now);
    if (!phaseAllowed(cfg.fireAtPhase, phase)) return "skipped";

    let evaluation: StrategyEvaluation | null;
    try { evaluation = strategy.evaluate(race); }
    catch (e) { this.note(`${strategy.id} eval error on ${race.id}: ${(e as Error).message}`); return "skipped"; }
    if (!evaluation) return "skipped";
    if (evaluation.evPercent < cfg.evThreshold) return "below-threshold";

    // Multi-leg evaluations from per-race evaluate() are unusual but legal —
    // route them through the multi-leg booker too.
    if (evaluation.legs && evaluation.legs.length > 0) {
      this.bookMultiLegTicket(strategy.id, cfg, evaluation, now);
      return "matched";
    }

    // Normalize selection / selections. Single-pick wagers (WIN/PLACE/SHOW)
    // emit `selection`; multi-pick in-race exotics (EXACTA/TRIFECTA) emit
    // `selections` with the key horse first. Either way, the first entry is
    // the runner we monitor with the optimal-timer.
    const selections = evaluation.selections && evaluation.selections.length > 0
      ? evaluation.selections
      : evaluation.selection ? [evaluation.selection]
      : [];
    if (selections.length === 0) return "skipped";
    const keySelection = selections[0];
    const runner = race.runners.find(r => r.program === keySelection);
    if (!runner || runner.scratched) return "skipped";

    // Active tickets from this strategy for this race in the current race
    // window. Settled (won/lost) tickets are excluded — TVG reuses raceIds
    // like `TVG-CBY-1` across days, so a prior day's settled bet would falsely
    // block today's evaluation. Aborted/void don't count either; those are dead
    // opportunities.
    const existingTickets = Tickets.list().filter(t =>
      t.strategyId === strategy.id &&
      t.raceId === race.id &&
      (t.status === "staged" || t.status === "open"),
    );

    // If we've already promoted to open in this race window, we've committed
    // to a real bet. Don't fire a second one, even if the strategy now likes
    // a different horse — the original commit stands. (This mirrors a human
    // who already clicked "Place bet" — you don't undo and re-bet.)
    const committed = existingTickets.find(t => t.status === "open");
    if (committed) return "skipped";

    // Existing staged ticket means we're holding an opportunity. We can
    // freely revise it as long as we haven't promoted yet, because odds and
    // EV shift right up to post and the optimal selection can change.
    const selectionKey = selections.join("-");
    const existingStaged = existingTickets.find(t => t.status === "staged");
    if (existingStaged) {
      const existingKey = existingStaged.selections.join("-");
      if (existingKey === selectionKey) {
        // Same pick(s), refreshed signal — update match EV/odds/trueP so the
        // UI reflects the current state of the opportunity. Keep capturedTrueP
        // in sync with capturedEV so both use the same calibration.
        const refreshMarketP = 1 / Math.max(1.2, runner.currentOdds);
        const refreshTrueP = evaluation.truePWin
          ?? (runner.truePWin != null
                ? strategyCalibratedTrueP(strategy.id, runner.truePWin, refreshMarketP)
                : undefined);
        Tickets.update(existingStaged.id, {
          capturedEV: evaluation.evPercent,
          capturedEVRaw: runner.evPercentRaw,
          capturedTrueP: refreshTrueP,
          capturedOdds: runner.currentOdds,
          reason: evaluation.reason,
        });
        return "refreshed";
      }
      // Strategy pivoted to a different selection set — abort the old stage so
      // it shows up in history as a documented pass, then fall through to
      // stage the new pick below.
      Tickets.update(existingStaged.id, {
        status: "aborted",
        abortedAt: now,
        abortReason: `pivoted to #${selectionKey} ${runner.name} @ +${evaluation.evPercent.toFixed(1)}% EV`,
      });
      this.note(
        `[${strategy.id}] PIVOT ${race.trackCode} R${race.raceNumber} ` +
        `#${existingKey} → #${selectionKey} ${runner.name} ` +
        `(new match EV +${evaluation.evPercent.toFixed(1)}%)`,
      );
    }

    // Stage the opportunity — for single-runner wagers, no stake committed
    // yet and no odds locked; the promoteStagedTickets pass decides whether
    // to actually fire and at what live odds. For in-race exotics
    // (EXACTA/TRIFECTA), the strategy already computed the per-combo math
    // (stake size + estimated payout from the exotic-pool calc), so we
    // record those at stage time and the promoter preserves them.
    const isExoticInRace = evaluation.type === "EXACTA" || evaluation.type === "TRIFECTA";
    const exoticCombos = evaluation.combos ?? selections.length;
    const exoticStake = isExoticInRace ? cfg.stake * exoticCombos : 0;
    const exoticPayout = isExoticInRace ? (evaluation.estimatedPayout ?? 0) : 0;
    // Capture a strategy-calibrated trueP alongside the raw adapter blend so
    // the tickets page can render "model fair" / "live EV" using the same
    // probability the strategy itself is gating on. For strategies that don't
    // recalibrate (everything except tvg-baseline today), this passes the
    // adapter's value through unchanged.
    const stageMarketP = 1 / Math.max(1.2, runner.currentOdds);
    const stageTrueP = evaluation.truePWin
      ?? (runner.truePWin != null
            ? strategyCalibratedTrueP(strategy.id, runner.truePWin, stageMarketP)
            : undefined);
    const ticket: Ticket = {
      id: `auto_${strategy.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      raceId: race.id,
      trackCode: race.trackCode,
      raceNumber: race.raceNumber,
      trackName: race.track,
      horseName: runner.name,
      type: evaluation.type,
      selections,
      stake: exoticStake,
      potentialPayout: exoticPayout,
      capturedEV: evaluation.evPercent,
      capturedEVRaw: runner.evPercentRaw,
      capturedTrueP: stageTrueP,
      capturedOdds: runner.currentOdds,
      placedAt: now,           // overwritten at promotion to the fire moment
      postTime: race.postTime,
      status: "staged",
      mode: "auto",
      strategyId: strategy.id,
      reason: evaluation.reason,
      stagedAt: now,
    };
    Tickets.add(ticket);
    this.note(
      `[${strategy.id}] ${existingStaged ? "RESTAGE" : "STAGE"} ${race.trackCode} R${race.raceNumber} ${evaluation.type} #${selectionKey} ${runner.name} ` +
      `@ ${runner.fractionalOdds} match EV +${evaluation.evPercent.toFixed(1)}% · ${phase} · ${evaluation.reason}`,
    );
    return existingStaged ? "pivoted" : "staged";
  }

  forceTick() {
    this.lastTick = 0;
    return this.tickIfDue();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __toteflowAutobook: Engine | undefined;
}
// HMR-safe: replace cached instance if it's missing newly-added methods (dev
// reloads preserve the global but not class shape).
const cachedAutobook = globalThis.__toteflowAutobook;
const autobookStale = !!cachedAutobook && (
  typeof (cachedAutobook as any).bookMultiLegTicket !== "function" ||
  typeof (cachedAutobook as any).bookCarryoverTicket !== "function" ||
  typeof (cachedAutobook as any).promoteStagedTickets !== "function"
);
export const autobook = (cachedAutobook && !autobookStale)
  ? cachedAutobook
  : (globalThis.__toteflowAutobook = new Engine());
autobook.start();
