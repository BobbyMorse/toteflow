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

// Fire window: paper-only, so no manual placement lead time to reserve. The
// old T-30s→T-15s (scheduled) window fired well before actual off on races
// with meaningful post drag (harness routinely 30-90s past scheduled post
// while the pool stays open). Late-steam pool moves during drag — the kind
// that push a 19/1 shot to 2/1 by close on a harness race — landed AFTER
// we'd already committed at the pre-drag price. The fire was locked at
// +9% EV and the closer settled at -83%.
//
// The fix is to hold through the pre-drag pool convergence and fire IN the
// drag window itself, using TVG's status.code as the ground truth for
// actual off:
//   - status "IC" ("Up Next") = pool open, horses haven't broken → keep holding
//   - status "SK" ("Race Off") = pool closed → too late, MISSED
// So we WAIT while msToPost > 0 with status IC, then fire on the first tick
// where msToPost has gone negative (drag has started) while status is still
// IC. Each hold-tick re-runs the strategy's EV check; a pool move that
// crashes EV before we fire gets caught by EV_COLLAPSE_FLOOR.
//
// If the adapter doesn't expose status.code, we fall back to the legacy
// T-30s→T-15s scheduled window (no way to detect drag without the feed).
const HARD_FIRE_MS = 15_000;        // legacy: T-15s scheduled last-chance fire (feeds w/o status)
const MIN_HOLD_MS = 30_000;         // legacy: T-30s scheduled earliest fire  (feeds w/o status)
const DRAG_MAX_MS = 90_000;         // 90s past scheduled — beyond this, feed is stale, abort
const EV_COLLAPSE_FLOOR_PCT = -5;   // soft floor: tolerate modest decay, kill outright collapses

function fmtMs(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function decideBetWindow({ race, runner, msToPost }: DecideInput): BetWindowDecision {
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

  const currentEv = runner.evPercent;
  const currentOdds = runner.currentOdds;
  const hasStatusFeed = !!race.statusCode;

  // Race actually off (SK). Ground-truth signal from TVG's status.code — the
  // only reliable indicator that horses have broken and pool is closed. Any
  // staged ticket at this point missed its fire window.
  if (race.statusCode === "SK") {
    return {
      status: "MISSED",
      headline: "OFF — race went off (SK)",
      detail: "TVG status flipped to Race Off before we fired",
      currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  // Stale feed: past scheduled post by more than DRAG_MAX_MS with no off
  // signal. Bail rather than sit on a dead ticket forever.
  if (msToPost <= -DRAG_MAX_MS) {
    return {
      status: "MISSED",
      headline: "OFF — feed stale",
      detail: `${Math.floor(-msToPost / 1000)}s past scheduled post with no off signal — feed likely stale`,
      currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  // EV-collapse abort: applies whenever we're close enough to post that live
  // EV is the truthful signal (T-30s scheduled through the drag window). This
  // is what catches the 19/1→2/1 harness late-steam collapses — the pool
  // moves through drag re-price the horse and EV crashes past the floor
  // before we ever fire.
  if (msToPost <= MIN_HOLD_MS && currentEv < EV_COLLAPSE_FLOOR_PCT) {
    const window = msToPost > 0 ? fmtMs(msToPost) : `${Math.floor(-msToPost / 1000)}s into drag`;
    return {
      status: "ABORT",
      headline: "PASS — EV collapsed",
      detail: `EV ${currentEv.toFixed(1)}% at ${window} · below ${EV_COLLAPSE_FLOOR_PCT}% floor, model edge gone`,
      currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  // === Fire logic ===
  //
  // With a status feed: hold through pre-schedule pool convergence, fire in
  // the drag window itself. This is the load-bearing change: firing at
  // scheduled T-30s meant late-steam pool moves during drag landed after
  // the ticket was committed. Firing in drag means the strategy has seen
  // the pool through its final convergence pass and EV_COLLAPSE_FLOOR has
  // had one more shot to abort if the model edge died.
  //
  // Without a status feed: fall back to the legacy T-30s→T-15s scheduled
  // window since we have no way to know whether the race has actually gone
  // off.
  if (hasStatusFeed) {
    if (msToPost > 0) {
      return {
        status: "WAIT",
        headline: "WAIT — pre-post",
        detail: `Post in ${fmtMs(msToPost)} · holding for drag window (fire in drag or on SK)`,
        currentOdds,
        currentEv,
        evSlopePctPerMin: null,
        msToPost,
      };
    }
    // In drag (msToPost between 0 and -DRAG_MAX_MS, status IC): fire.
    return {
      status: "LOCKED",
      headline: "BET NOW — in drag",
      detail: `${Math.floor(-msToPost / 1000)}s past scheduled · race still Up Next, pool nearly closed`,
      currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }

  // Legacy fallback (no status feed).
  if (msToPost <= 0) {
    return {
      status: "MISSED",
      headline: "OFF — missed window",
      detail: "Post time passed (no status feed to confirm actual off)",
      currentOdds,
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
      currentOdds,
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
      currentOdds,
      currentEv,
      evSlopePctPerMin: null,
      msToPost,
    };
  }
  return {
    status: "BET_NOW",
    headline: "BET NOW — in window",
    detail: `EV ${currentEv >= 0 ? "+" : ""}${currentEv.toFixed(1)}% at ${fmtMs(msToPost)} · pool settled enough to trust`,
    currentOdds,
    currentEv,
    evSlopePctPerMin: null,
    msToPost,
  };
}
