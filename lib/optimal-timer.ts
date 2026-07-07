// Decides whether a candidate bet should be placed now or held. In pari-mutuel,
// odds keep shifting until post as the pool fills in — so a model-EV reading 5
// minutes out is much noisier than one 30 seconds out. This function looks at
// the runner's current model EV and time remaining, and tells the user (or bot)
// whether to wait, fire, or that the lock window is closing.
import type { Race, Runner } from "./types";

export type BetWindowStatus = "WAIT" | "BET_NOW" | "LOCKED" | "MISSED" | "STALE" | "ABORT";

export interface BetWindowDecision {
  status: BetWindowStatus;
  headline: string;
  detail: string;
  currentOdds: number | null;
  currentEv: number | null;
  evSlopePctPerMin: number | null;
  msToPost: number;
}

interface DecideInput {
  race: Race | null;
  runner: Runner | null;
  msToPost: number;
}

// Firing window tuned for manual placement on FanDuel/DraftKings — neither
// platform exposes a programmatic bet-placement API to retail, so signals
// have to surface with enough lead time for the user to navigate the ADW
// UI and submit the bet before pool close. The window is T-2min to T-4min:
//   - MIN_HOLD_MS = 240s: don't fire before T-4min (pool still settling)
//   - HARD_FIRE_MS = 120s: at T-2min, force-fire any still-waiting signal
//                          — beyond this, user can't realistically place
// Inside the window, fire as soon as the model EV is above the collapse
// floor. Past T-2min, staged tickets that never cleared get LOCKED for a
// last-chance fire.
const HARD_FIRE_MS = 120_000;       // T-2min: force-fire; beyond this is unplayable
const MIN_HOLD_MS = 240_000;        // T-4min: before this, pool is too noisy to trust
const EV_COLLAPSE_FLOOR_PCT = -5;   // soft floor: tolerate modest decay, kill outright collapses

function fmtMs(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function decideBetWindow({ race, runner, msToPost }: DecideInput): BetWindowDecision {
  if (msToPost <= 0) {
    return {
      status: "MISSED",
      headline: "OFF — missed window",
      detail: "Post time passed",
      currentOdds: runner?.currentOdds ?? null,
      currentEv: null,
      evSlopePctPerMin: null,
      msToPost,
    };
  }
  if (!race || !runner) {
    return {
      status: "STALE",
      headline: "No live data",
      detail: "Race feed dropped this race — verify on ADW",
      currentOdds: null,
      currentEv: null,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  // Use the strategy's live model EV (model fair-probability vs market odds),
  // not the market-implied EV — the latter is just minus-takeout and would
  // abort every non-favorite ticket regardless of edge.
  const currentEv = runner.evPercent;

  // EV-collapse abort: once we're inside the firing window (T-4min or later),
  // kill picks whose live model EV has dropped below the soft floor. A small
  // dip into negative territory is tolerated — most public models drive the
  // pool slightly past fair before close, and bets in that band can still
  // grade out neutral-to-positive on CLV. Bets that crash well below the
  // floor are dead and should not fire.
  if (msToPost <= MIN_HOLD_MS && currentEv < EV_COLLAPSE_FLOOR_PCT) {
    return {
      status: "ABORT",
      headline: "PASS — EV collapsed",
      detail: `EV ${currentEv.toFixed(1)}% at ${fmtMs(msToPost)} · below ${EV_COLLAPSE_FLOOR_PCT}% floor, model edge gone`,
      currentOdds: runner.currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  if (msToPost <= HARD_FIRE_MS) {
    return {
      status: "LOCKED",
      headline: "BET NOW — final window",
      detail: `T-${Math.ceil(msToPost / 1000)}s · last chance, pool closing`,
      currentOdds: runner.currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  if (msToPost > MIN_HOLD_MS) {
    return {
      status: "WAIT",
      headline: "WAIT — too early",
      detail: `Post in ${fmtMs(msToPost)} · pool still settling, EV reading is noisy`,
      currentOdds: runner.currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  return {
    status: "BET_NOW",
    headline: "BET NOW — in window",
    detail: `EV ${currentEv >= 0 ? "+" : ""}${currentEv.toFixed(1)}% at ${fmtMs(msToPost)} · pool settled enough to trust`,
    currentOdds: runner.currentOdds,
    currentEv,
    evSlopePctPerMin: null,
    msToPost,
  };
}
