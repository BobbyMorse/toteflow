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
  source: string;           // "tvg" | "hkjc" | "racingapi" | ...
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

export interface Alert {
  id: string;
  raceId: string;
  type: "steam" | "overlay" | "pool-shift" | "scratch" | "phase";
  severity: "info" | "warn" | "high";
  title: string;
  body: string;
  ts: number;
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
  // Legacy mirrors of capturedEV / closingEV. Originally tracked the uncapped
  // EV separately from a +25%-capped capturedEV/closingEV. The cap has since
  // been removed, so for new tickets these equal their non-Raw twin; kept on
  // the type so old rows still deserialize.
  capturedEVRaw?: number;
  closingEVRaw?: number;
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
