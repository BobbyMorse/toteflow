// Persistent storage. Tickets + strategy configs hit SQLite immediately;
// hot reads stay in memory for speed. Boots by hydrating the in-memory
// cache from disk so weeks of accumulated data survive restarts.
import type { Ticket } from "./types";
import type { StrategyConfig } from "./strategies/types";
import { strategies } from "./strategies";
import { db } from "./db";
import {
  adapterTruePFromRawEV,
  calibrateTVGBaselineTrueP,
  evPercentFromTrueP,
} from "./strategy-calibration";

interface ClosingOddsSnap {
  raceId: string;
  capturedAt: number;
  odds: Record<string, number>;
  ev: Record<string, number>;
  evRaw?: Record<string, number>;
  // Per-runner PLACE-pool EV at race-off (Dr.Z Ziemba/Hausch). Populated
  // whenever the race exposes per-runner pool amounts + adequate liquidity.
  // Used to grade closing EV on PLACE tickets, analogously to how `ev`
  // grades WIN tickets.
  placeEv?: Record<string, number>;
}

interface Store {
  tickets: Ticket[];
  strategyConfigs: Record<string, StrategyConfig>;
  closingOdds: Map<string, ClosingOddsSnap>;
  globalEnabled: boolean;
  hydrated: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __toteflowStore: Store | undefined;
}

// Default config policy: strategies with structural edge OR demonstrated
// positive CLV against the pool are enabled. Strategies that fire inside
// T-2min are off — they can't be placed manually on FanDuel/DraftKings (no
// public bet-placement API for retail).
//
// On tvg-baseline: prior assumption was that consumer-facing TVG
// winProbability gets fully arbitraged by post. Real paper data over
// hundreds of bets shows otherwise — it produces strong +CLV, which means
// the public DOESN'T fully bet the model. Kept live; harness variant runs
// on its own lower model weight (see strategy-calibration.ts).
const defaultPerStrategy: Record<string, StrategyConfig> = {
  // Enabled — pure-predictive but showing real CLV signal in paper data
  "tvg-baseline":   { enabled: true,  evThreshold: 10, stake: 20, fireAtPhase: "action" },
  // Disabled — never validated, no signal yet
  "lone-speed":     { enabled: false, evThreshold: 5,  stake: 20, fireAtPhase: "action" },
  "always-fav":     { enabled: false, evThreshold: -100, stake: 20, fireAtPhase: "action" },
  // Enabled — structural edge, math-based, manually playable
  "fav-fade":       { enabled: true,  evThreshold: 3,  stake: 20, fireAtPhase: "action" },
  "pass-control":   { enabled: true,  evThreshold: 0,  stake: 20, fireAtPhase: "action" },
  "dr-z-place":     { enabled: true,  evThreshold: 3,  stake: 20, fireAtPhase: "action" },
  "bridge-jumper":  { enabled: true,  evThreshold: 2,  stake: 20, fireAtPhase: "action" },
  // Carryover Pick-N: stake = desired base ticket cost per combo; the booker
  // floors this to the wager's actual minimum via lib/wager-minimums.ts (some
  // tracks/wagers reject $0.50). evThreshold = min rawEdgePct from the scanner
  // (e.g. 30 = "only fire when ~+30% edge or better").
  "carryover-pickn":{ enabled: true,  evThreshold: 30, stake: 0.5, fireAtPhase: "action" },
  // Track bias: live EV can be slightly negative if the bias signal is strong
  // (strategy enforces its own -2% floor internally), so threshold stays low.
  "track-bias":     { enabled: true,  evThreshold: 0,  stake: 20, fireAtPhase: "action" },
  // Exotic wagers — `stake` is the per-combo base; the booker multiplies it by
  // combo count (2 for exacta box, 6 for trifecta box, 1 for single-combo DD).
  // Conservative thresholds because exotic payout math is estimated from pool
  // size + Harville joint probabilities (the TVG results feed doesn't expose
  // per-combo payoffs), so paper P/L is directional, not bookable-precise.
  "exacta-overlay-pair": { enabled: true, evThreshold: 2, stake: 2,    fireAtPhase: "action" },
  "trifecta-key":        { enabled: true, evThreshold: 3, stake: 0.5,  fireAtPhase: "action" },
  // DD is cross-race — fires at discovery phase on leg-1 so we have time to
  // book before leg-1's window closes.
  "dd-consensus":        { enabled: true, evThreshold: 3, stake: 1,    fireAtPhase: "discovery" },
};

// -------- DB row serialization --------

function rowToTicket(row: any): Ticket {
  return {
    id: row.id,
    raceId: row.raceId,
    trackCode: row.trackCode ?? undefined,
    trackName: row.trackName ?? undefined,
    raceNumber: row.raceNumber ?? undefined,
    horseName: row.horseName ?? undefined,
    type: row.type,
    selections: JSON.parse(row.selections),
    stake: row.stake,
    potentialPayout: row.potentialPayout,
    capturedEV: row.capturedEV,
    capturedOdds: row.capturedOdds,
    placedAt: row.placedAt,
    postTime: row.postTime ?? undefined,
    status: row.status,
    mode: row.mode,
    strategyId: row.strategyId ?? undefined,
    reason: row.reason ?? undefined,
    settledAt: row.settledAt ?? undefined,
    realizedPL: row.realizedPL ?? undefined,
    winners: row.winners ? JSON.parse(row.winners) : undefined,
    closingOdds: row.closingOdds ?? undefined,
    closingEV: row.closingEV ?? undefined,
    capturedEVRaw: row.capturedEVRaw ?? undefined,
    closingEVRaw: row.closingEVRaw ?? undefined,
    capturedTrueP: row.capturedTrueP ?? undefined,
    shadow: row.shadow ? true : undefined,
    legs: row.legs ? JSON.parse(row.legs) : undefined,
    stagedAt: row.stagedAt ?? undefined,
    abortedAt: row.abortedAt ?? undefined,
    abortReason: row.abortReason ?? undefined,
  };
}

const stmtInsertTicket = db.prepare(`
  INSERT INTO tickets (
    id, raceId, trackCode, trackName, raceNumber, horseName, type, selections,
    stake, potentialPayout, capturedEV, capturedEVRaw, capturedTrueP, capturedOdds, placedAt, postTime,
    status, mode, strategyId, reason, settledAt, realizedPL, winners,
    closingOdds, closingEV, closingEVRaw, shadow, legs,
    stagedAt, abortedAt, abortReason
  ) VALUES (
    @id, @raceId, @trackCode, @trackName, @raceNumber, @horseName, @type, @selections,
    @stake, @potentialPayout, @capturedEV, @capturedEVRaw, @capturedTrueP, @capturedOdds, @placedAt, @postTime,
    @status, @mode, @strategyId, @reason, @settledAt, @realizedPL, @winners,
    @closingOdds, @closingEV, @closingEVRaw, @shadow, @legs,
    @stagedAt, @abortedAt, @abortReason
  )
`);

// Update covers two distinct lifecycle transitions:
//   - staged → open  (promotion): rewrites stake, capturedOdds, capturedEV,
//                                 potentialPayout, placedAt at the moment a
//                                 human would have actually placed the bet
//   - open → won/lost (settlement): writes settledAt, realizedPL, winners, closingOdds
//   - staged → aborted: writes abortedAt, abortReason
// All branches share this single statement; non-applicable fields pass through
// as their existing values.
const stmtUpdateTicket = db.prepare(`
  UPDATE tickets SET
    status          = @status,
    stake           = @stake,
    capturedOdds    = @capturedOdds,
    capturedEV      = @capturedEV,
    capturedEVRaw   = @capturedEVRaw,
    capturedTrueP   = @capturedTrueP,
    potentialPayout = @potentialPayout,
    placedAt        = @placedAt,
    settledAt       = @settledAt,
    realizedPL      = @realizedPL,
    winners         = @winners,
    closingOdds     = @closingOdds,
    closingEV       = @closingEV,
    closingEVRaw    = @closingEVRaw,
    shadow          = @shadow,
    stagedAt        = @stagedAt,
    abortedAt       = @abortedAt,
    abortReason     = @abortReason
  WHERE id = @id
`);

const stmtSelectAllTickets = db.prepare(`SELECT * FROM tickets ORDER BY placedAt ASC`);

const stmtUpsertStrategyConfig = db.prepare(`
  INSERT INTO strategy_configs (id, enabled, evThreshold, stake, fireAtPhase)
  VALUES (@id, @enabled, @evThreshold, @stake, @fireAtPhase)
  ON CONFLICT(id) DO UPDATE SET
    enabled = excluded.enabled,
    evThreshold = excluded.evThreshold,
    stake = excluded.stake,
    fireAtPhase = excluded.fireAtPhase
`);

const stmtSelectAllStrategyConfigs = db.prepare(`SELECT * FROM strategy_configs`);

const stmtGetMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
const stmtSetMeta = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

function ticketToRow(t: Ticket): Record<string, unknown> {
  return {
    id: t.id,
    raceId: t.raceId,
    trackCode: t.trackCode ?? null,
    trackName: t.trackName ?? null,
    raceNumber: t.raceNumber ?? null,
    horseName: t.horseName ?? null,
    type: t.type,
    selections: JSON.stringify(t.selections),
    stake: t.stake,
    potentialPayout: t.potentialPayout,
    capturedEV: t.capturedEV,
    capturedEVRaw: t.capturedEVRaw ?? null,
    capturedTrueP: t.capturedTrueP ?? null,
    capturedOdds: t.capturedOdds,
    placedAt: t.placedAt,
    postTime: t.postTime ?? null,
    status: t.status,
    mode: t.mode,
    strategyId: t.strategyId ?? null,
    reason: t.reason ?? null,
    settledAt: t.settledAt ?? null,
    realizedPL: t.realizedPL ?? null,
    winners: t.winners ? JSON.stringify(t.winners) : null,
    closingOdds: t.closingOdds ?? null,
    closingEV: t.closingEV ?? null,
    closingEVRaw: t.closingEVRaw ?? null,
    shadow: t.shadow ? 1 : 0,
    legs: t.legs ? JSON.stringify(t.legs) : null,
    stagedAt: t.stagedAt ?? null,
    abortedAt: t.abortedAt ?? null,
    abortReason: t.abortReason ?? null,
  };
}

function configToRow(id: string, c: StrategyConfig): Record<string, unknown> {
  return {
    id,
    enabled: c.enabled ? 1 : 0,
    evThreshold: c.evThreshold,
    stake: c.stake,
    fireAtPhase: c.fireAtPhase,
  };
}

// -------- Hydration --------

function hydrate(): Store {
  const tickets = (stmtSelectAllTickets.all() as any[]).map(rowToTicket);
  const rows = stmtSelectAllStrategyConfigs.all() as any[];
  const configs: Record<string, StrategyConfig> = {};
  for (const r of rows) {
    configs[r.id] = {
      enabled: !!r.enabled,
      evThreshold: r.evThreshold,
      stake: r.stake,
      fireAtPhase: r.fireAtPhase,
    };
  }
  // Make sure every registered strategy has a config (fill from defaults)
  for (const s of strategies) {
    if (!configs[s.id]) {
      configs[s.id] = { ...(defaultPerStrategy[s.id] ?? { enabled: false, evThreshold: 5, stake: 20, fireAtPhase: "action" }) };
      stmtUpsertStrategyConfig.run(configToRow(s.id, configs[s.id]));
    }
  }
  const globalEnabledRaw = (stmtGetMeta.get("globalEnabled") as { value: string } | undefined)?.value;
  if (!globalEnabledRaw) stmtSetMeta.run("globalEnabled", "true");

  // Reconcile every hydration: recompute closingEV for every settled WIN
  // ticket from the odds drift (using raw captured when available, else
  // capped). The previous closingEV was sometimes the race-off snapshot,
  // which evaluated EV at the closing market price + close-time trueP —
  // misleading for grading our locked-in bet (and on bombs >60/1 it collapses
  // to ~-takeout regardless of our captured price). The scaled-from-fire
  // approach is honest: same horse, same model probability, just rescaled
  // payout. Cheap + idempotent.
  {
    const stmtBackfill = db.prepare(
      "UPDATE tickets SET closingEV = ?, closingEVRaw = ? WHERE id = ?",
    );
    let n = 0;
    for (const t of tickets) {
      if (t.status !== "won" && t.status !== "lost") continue;
      // Base off the strategy-calibrated capturedEV so closing EV matches the
      // "was" label. Using capturedEVRaw (adapter 65% weight) here inflated
      // tvg-baseline closing EVs to ~2× the calibrated fire EV.
      const derived = deriveClosingEV({
        type: t.type,
        capturedEV: t.capturedEV,
        capturedOdds: t.capturedOdds,
        closingOdds: t.closingOdds,
      });
      if (derived == null) continue;
      // Skip the write if nothing changed (avoids db churn on stable rows).
      if (Math.abs((t.closingEV ?? Number.NaN) - derived) < 0.01
          && Math.abs((t.closingEVRaw ?? Number.NaN) - derived) < 0.01) continue;
      t.closingEV = derived;
      t.closingEVRaw = derived;
      stmtBackfill.run(derived, derived, t.id);
      n++;
    }
    if (n > 0) console.log(`[storage] reconciled closingEV on ${n} settled tickets`);
  }

  // One-time-per-row backfill: tvg-baseline tickets fired before commit d712227
  // wrote `capturedEV` as the adapter's raw blend (65% model weight) instead of
  // the strategy's own calibrated value (30% model weight). The ticket display
  // now derives "model fair" / "live EV" from the strategy calibration, so
  // stale rows show a raw "was +X%" that doesn't match the reason line. Detect
  // pre-fix rows (capturedEV == capturedEVRaw within rounding) and recompute
  // capturedEV + capturedTrueP from the raw EV, treating takeout as 0.16
  // (matches the tvg-baseline FALLBACK_TAKEOUT — real value isn't persisted).
  // Idempotent: the equality check fails after the first pass.
  {
    const stmtBackfillCalib = db.prepare(
      "UPDATE tickets SET capturedEV = ?, capturedTrueP = ? WHERE id = ?",
    );
    const FALLBACK_TAKEOUT = 0.16;
    let n = 0;
    for (const t of tickets) {
      if (t.strategyId !== "tvg-baseline") continue;
      if (t.capturedEVRaw == null) continue;
      if (!(t.capturedOdds > 1)) continue;
      // Rounding: capturedEV was written as the strategy's own EV (short
      // float), so a pre-fix row has capturedEV within ~0.01 of capturedEVRaw.
      if (Math.abs(t.capturedEV - t.capturedEVRaw) > 0.05) continue;
      const adapterP = adapterTruePFromRawEV(t.capturedEVRaw, t.capturedOdds, FALLBACK_TAKEOUT);
      if (adapterP == null) continue;
      const marketP = 1 / t.capturedOdds;
      const calibP = calibrateTVGBaselineTrueP(adapterP, marketP);
      const calibEV = evPercentFromTrueP(calibP, t.capturedOdds, FALLBACK_TAKEOUT);
      t.capturedEV = calibEV;
      t.capturedTrueP = calibP;
      stmtBackfillCalib.run(calibEV, calibP, t.id);
      n++;
    }
    if (n > 0) console.log(`[storage] backfilled strategy-calibrated capturedEV on ${n} tvg-baseline tickets`);
  }

  return {
    tickets,
    strategyConfigs: configs,
    closingOdds: new Map(),
    globalEnabled: globalEnabledRaw !== "false",
    hydrated: true,
  };
}

const store = globalThis.__toteflowStore ?? (globalThis.__toteflowStore = hydrate());

// HMR-safe: ensure every registered strategy has a config row in both the
// in-memory store and the DB. Without this, strategies added after the store
// was first hydrated won't get a config (dev) until a full server restart.
for (const s of strategies) {
  if (!store.strategyConfigs[s.id]) {
    const cfg = defaultPerStrategy[s.id] ?? { enabled: false, evThreshold: 5, stake: 20, fireAtPhase: "action" };
    store.strategyConfigs[s.id] = cfg;
    stmtUpsertStrategyConfig.run(configToRow(s.id, cfg));
  }
}

// -------- Public API --------

export const Tickets = {
  list(): Ticket[] { return store.tickets.slice().reverse(); },
  add(t: Ticket) {
    store.tickets.push(t);
    stmtInsertTicket.run(ticketToRow(t));
  },
  update(id: string, patch: Partial<Ticket>) {
    const t = store.tickets.find(x => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    stmtUpdateTicket.run({
      id: t.id,
      status: t.status,
      stake: t.stake,
      capturedOdds: t.capturedOdds,
      capturedEV: t.capturedEV,
      capturedEVRaw: t.capturedEVRaw ?? null,
      capturedTrueP: t.capturedTrueP ?? null,
      potentialPayout: t.potentialPayout,
      placedAt: t.placedAt,
      settledAt: t.settledAt ?? null,
      realizedPL: t.realizedPL ?? null,
      winners: t.winners ? JSON.stringify(t.winners) : null,
      closingOdds: t.closingOdds ?? null,
      closingEV: t.closingEV ?? null,
      closingEVRaw: t.closingEVRaw ?? null,
      shadow: t.shadow ? 1 : 0,
      stagedAt: t.stagedAt ?? null,
      abortedAt: t.abortedAt ?? null,
      abortReason: t.abortReason ?? null,
    });
  },
  byId(id: string) { return store.tickets.find(x => x.id === id); },
  openByRace(raceId: string) { return store.tickets.filter(t => t.raceId === raceId && t.status === "open"); },
  byStrategy(id: string) { return store.tickets.filter(t => t.strategyId === id); },
  // True if another AUTO ticket is currently live on this (raceId, type, selections).
  // Used at promotion time to dedup bankroll exposure when two strategies pick the same horse
  // in the same race. Only `open` tickets count: staged hasn't committed stake yet, and
  // settled/aborted tickets are from prior race days (TVG reuses raceIds like `TVG-CBY-1`
  // across days, so historical matches would falsely shadow every recurring favorite).
  hasRealBet(raceId: string, type: Ticket["type"], selections: string[]) {
    const key = selections.join("-");
    return store.tickets.some(t =>
      t.mode === "auto" &&
      !t.shadow &&
      t.status === "open" &&
      t.raceId === raceId &&
      t.type === type &&
      t.selections.join("-") === key,
    );
  },
  clear() {
    store.tickets.length = 0;
    db.exec("DELETE FROM tickets");
  },
  count() { return store.tickets.length; },
};

export const AutoBook = {
  globalEnabled() { return store.globalEnabled; },
  setGlobalEnabled(v: boolean) {
    store.globalEnabled = v;
    stmtSetMeta.run("globalEnabled", v ? "true" : "false");
    return v;
  },

  strategyConfig(id: string): StrategyConfig | undefined { return store.strategyConfigs[id]; },
  allStrategyConfigs() { return store.strategyConfigs; },
  setStrategyConfig(id: string, patch: Partial<StrategyConfig>) {
    const existing = store.strategyConfigs[id];
    if (!existing) return undefined;
    Object.assign(existing, patch);
    stmtUpsertStrategyConfig.run(configToRow(id, existing));
    return existing;
  },

};

export const Closing = {
  snapshot(
    raceId: string,
    oddsByProgram: Record<string, number>,
    evByProgram: Record<string, number>,
    evRawByProgram?: Record<string, number>,
    placeEvByProgram?: Record<string, number>,
  ) {
    store.closingOdds.set(raceId, {
      raceId,
      capturedAt: Date.now(),
      odds: oddsByProgram,
      ev: evByProgram,
      evRaw: evRawByProgram,
      placeEv: placeEvByProgram,
    });
  },
  oddsFor(raceId: string, program: string): number | undefined {
    return store.closingOdds.get(raceId)?.odds[program];
  },
  evFor(raceId: string, program: string): number | undefined {
    // Defensive: HMR-cached snapshots from before `ev` was added to the snap
    // shape have no `ev` field — guard so we return undefined instead of throwing.
    return store.closingOdds.get(raceId)?.ev?.[program];
  },
  evRawFor(raceId: string, program: string): number | undefined {
    return store.closingOdds.get(raceId)?.evRaw?.[program];
  },
  placeEvFor(raceId: string, program: string): number | undefined {
    return store.closingOdds.get(raceId)?.placeEv?.[program];
  },
};

// Recover closing EV from data already on the ticket. Used when the live
// snapshot is missing (server restarted between snapshot and settle, or the
// ticket pre-dates the snapshot's `ev` field). Assumes model probability is
// unchanged between fire and post — same assumption CLV implicitly makes —
// and scales captured EV by the odds ratio. Exact for the (p*dec−1) EV form,
// within ~1pp of the takeout-aware form. WIN-only: PLACE/SHOW EV depends on
// pool composition, not just odds, so we can't recover it from closingOdds.
export function deriveClosingEV(t: Pick<Ticket, "type" | "capturedEV" | "capturedOdds" | "closingOdds">): number | undefined {
  if (t.type !== "WIN") return undefined;
  if (!t.closingOdds || t.closingOdds <= 0) return undefined;
  if (!t.capturedOdds || t.capturedOdds <= 0) return undefined;
  return (t.capturedEV + 100) * (t.closingOdds / t.capturedOdds) - 100;
}
