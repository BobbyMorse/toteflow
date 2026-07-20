import type { TrackType } from "./track-types";

export type Phase = "scheduled" | "discovery" | "action" | "chaos" | "off" | "official";

export interface Runner {
  program: string;          // "1", "1A", etc.
  saddleNumber: number;
  name: string;
  jockey?: string;
  trainer?: string;
  morningLine?: number;     // decimal (e.g. 5.0 for 4-1)
  currentOdds: number;      // decimal (1 = even, 2 = 1/1, etc. stored as fractional+1)
  fractionalOdds: string;   // human "7/2"
  prevOdds?: number;
  oddsHistory: { t: number; odds: number }[];
  winPoolShare: number;     // 0..1 — market implied probability
  // Raw dollar amounts in each pool from the tote feed (TVG biPools).
  // Required for Dr. Z place/show inefficiency calculations.
  winPoolAmount?: number;
  placePoolAmount?: number;
  showPoolAmount?: number;
  truePWin?: number;        // 0..1 — latent fair probability (sim only; for live feeds == market)
  steamScore: number;       // 0..100
  evPercent: number;        // model EV%. Lower-bounded at -100% (can't lose
                            // more than stake) but uncapped on the upside —
                            // the previous +25% cap was destroying signal.
  evPercentRaw?: number;    // legacy mirror of evPercent kept for backward
                            // compat with rows written while the +25% cap
                            // was in effect. New tickets store the same
                            // value here as evPercent.
  projectedFinalOdds?: number;
  scratched?: boolean;
  silkColor?: string;
}

export interface Race {
  id: string;               // "BEL-6"
  track: string;            // "Belmont Park"
  trackCode: string;        // "BEL"
  raceNumber: number;
  postTime: number;         // epoch ms
  surface: "Dirt" | "Turf" | "Synthetic" | "AWT";
  distance: string;         // "1 1/16M"
  purse?: number;
  conditions?: string;
  runners: Runner[];
  winPoolTotal: number;
  placePoolTotal?: number;
  showPoolTotal?: number;
  exactaPoolTotal: number;
  trifectaPoolTotal: number;
  // Real multi-leg pool data straight from the tote feed — P3/P4/P5/P6/J6 etc.
  // Only populated when the upstream provider actually relays the wager for
  // this race. Absence means the wager isn't offered on the user's ADW, so
  // the carryover scanner must not fabricate it.
  multiLegPools?: Array<{ code: string; name: string; amount: number }>;
  takeout: number;          // WIN-pool takeout (e.g. 0.16). Backward-compat alias for poolTakeout.win.
  poolTakeout?: { win: number; place: number; exotic: number };  // per-pool takeout when known
  phase: Phase;
  // Raw upstream status. TVG returns codes like "IC" ("Up Next" — pool open,
  // race hasn't gone off) and "SK" ("Race Off" — horses have broken, pool
  // closed). Populated by adapters that expose it; may be undefined for feeds
  // that don't. Used by the optimal-timer to fire on actual off instead of
  // scheduled post — harness "post drag" routinely delays actual off by
  // 30-90s past scheduled post while status stays IC.
  statusCode?: string;
  statusName?: string;
  source: string;           // always "tvg" in production; kept as a string for adapter flexibility
  lastTick: number;
  // How much to trust the EV column. "high" = bet on it, "low" = ignore EV.
  modelQuality?: "high" | "medium" | "low";
  modelQualityReason?: string;
  // Per-wager minimums straight from the tote feed, keyed by wager code
  // ("WN","PL","SH","P3","P4","P5","P6","J6","DB",etc.). Authoritative
  // truth for "what does the track actually accept" — overrides anything in
  // lib/wager-minimums.ts when present.
  wagerMinimums?: Record<string, { minWager: number; minTicket: number }>;
  // Breed/discipline classification derived from track code + name. Frozen on
  // the Race so the UI can show it and downstream consumers (grader, stats)
  // don't have to re-classify. Strategies still call classifyTrack() directly
  // for now — migrate them here later.
  trackType?: TrackType;
}

export interface Ticket {
  id: string;
  raceId: string;
  trackCode?: string;
  raceNumber?: number;
  trackName?: string;
  horseName?: string;
  type: "WIN" | "PLACE" | "SHOW" | "EXACTA" | "TRIFECTA" | "DD" | "P3" | "P4" | "P5" | "P6" | "J6";
  selections: string[];     // program numbers — flat for single-race types; flattened concat for Pick-N
  // For multi-race wagers (P3/P4/P5/P6/J6), per-leg structured picks. raceNumber
  // is the *track-local* race number; selections are the program numbers covered
  // on that leg. Combinations = product of leg sizes.
  legs?: Array<{ raceNumber: number; selections: string[] }>;
  stake: number;
  potentialPayout: number;
  capturedEV: number;
  capturedOdds: number;
  // Strategy EV at stage (match) time, frozen when the ticket is promoted.
  // capturedEV is the fire-time value; when the price moves between stage
  // and fire the two diverge, and the gap is the stage→fire EV drift.
  // Optional because it was added after some rows were written.
  stagedEV?: number;
  // Model-estimated true win probability at fire time. Frozen alongside
  // capturedEV / capturedOdds so the UI can show model-prob drift separately
  // from market-odds drift — the two move for different reasons (odds =
  // pool weight of money, trueP = model output). Optional because it was
  // added after some rows were written.
  capturedTrueP?: number;
  placedAt: number;         // for staged tickets: stage time, overwritten on promotion to fire time
  postTime?: number;
  // Lifecycle: staged → open → won/lost (or aborted if EV collapsed before fire).
  // - staged: strategy matched, holding for the optimal-timer to clear it to fire
  // - open:   promoted at the BET_NOW moment with live odds + real stake; pending settlement
  // - aborted: staged ticket killed because live EV went negative (or window missed)
  status: "staged" | "open" | "won" | "lost" | "void" | "aborted";
  mode: "manual" | "auto";
  // Filled after race result is known
  settledAt?: number;
  realizedPL?: number;
  winners?: string[];       // program numbers of actual finishers (1st = winners[0])
  // Staging metadata — separate from placedAt so we can audit hold time
  stagedAt?: number;
  abortedAt?: number;
  abortReason?: string;
  // Strategy attribution + CLV tracking
  strategyId?: string;
  reason?: string;
  closingOdds?: number;     // odds at race-off — used for CLV
  closingEV?: number;       // model EV at race-off — the truthful grading metric
                            // (captured EV is frozen at fire time and stops
                            // reflecting reality once odds move).
  // The ORIGINATING strategy's own EV for THIS exact bet, recomputed against
  // the closing pool composition and stamped by the autobook's per-tick
  // snapshotter (last write before the race leaves the feed = the closing
  // line — no off-time prediction needed). Only populated for strategies that
  // opt into `gateOnClosingEV`. Distinct from closingEV, which for exotics is
  // only a key-horse WIN-EV proxy: this re-runs the strategy's real thesis
  // (Dr.Z place EV / trifecta box EV) at close. The grader gates on it at
  // settle: a bet whose edge didn't survive to here is reclassified to shadow.
  closingStrategyEV?: number;
  // Legacy mirrors of capturedEV / closingEV. Originally tracked the uncapped
  // EV separately from a +25%-capped capturedEV/closingEV. The cap has since
  // been removed, so for new tickets these equal their non-Raw twin; kept on
  // the type so old rows still deserialize.
  capturedEVRaw?: number;
  closingEVRaw?: number;
  // How a winning payout was determined at settle. "tote" = actual pool payoff
  // from the results feed (trustworthy P/L). "estimated" = the strategy's own
  // book-time payout estimate (directional only — races whose payoff feed was
  // empty, or tickets settled before real-payoff grading landed).
  payoutSource?: "tote" | "estimated";
  // Hypothetical accounting for shadow tickets. shadowStake is the stake the
  // strategy WOULD have bet (its configured stake at promote time); shadowPL
  // is the settled P&L at that stake. Real stake/realizedPL stay 0 on shadow
  // tickets — these fields exist so per-strategy attribution can be measured
  // for strategies whose picks overlap (e.g. tvg-steam vs tvg-baseline)
  // without double-counting the canonical bankroll aggregates, which keep
  // excluding shadow. Forward-only: shadow tickets settled before 2026-07-17
  // have neither field.
  shadowStake?: number;
  shadowPL?: number;
  // True when another AUTO ticket already covered this (raceId, type, selections).
  // Shadow tickets keep full strategy attribution but carry stake/payout/P&L = 0
  // so we don't double-debit the bankroll when two strategies agree.
  shadow?: boolean;
}

export interface ProviderSummary {
  id: string;
  label: string;
  status: "live" | "demo" | "offline" | "needs-key";
  notes?: string;
}

export interface RacingProvider {
  id: string;
  label: string;
  status: ProviderSummary["status"];
  notes?: string;
  listRaces(): Promise<Race[]>;
  getRace(id: string): Promise<Race | null>;
}
