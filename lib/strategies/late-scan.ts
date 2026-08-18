import type { Race, Runner } from "../types";
import type { Strategy } from "./types";
import { calibrateTVGBaselineTrueP, evPercentFromTrueP } from "../strategy-calibration";

// Late full-field model SCANNERS. The stage→promote strategies commit to ONE
// pick per race, chosen early and held; at fire they only book the horse they've
// been tracking. These scanners instead re-run the model across the WHOLE field
// at the last second on live odds and consider EVERY qualifying runner —
// surfacing what the one-pick-early commitment leaves on the table once late
// money has revealed itself.
//
// Dual-mode booking: a bet at/above REAL_EV_FLOOR is a MAJOR edge and gets
// booked for REAL (unless another strategy already has that exact pick real —
// then it shadows to avoid double-counting the position). Everything from
// evThreshold up to the floor is booked SHADOW, so the full field-wide sweep is
// still measured without loading the book with marginal correlated bets.
//
// Two variants, one detector:
//   - tvg-late-scan       → model +EV, no steam filter. Counterfactual for
//                           tvg-baseline (one model pick, early hold): does a
//                           late field-wide sweep find +EV horses we skipped?
//   - tvg-late-steam-scan → model +EV AND crush in the 15-35% band. Counter-
//                           factual for tvg-steam (one model pick + steam gate):
//                           are there confirmed steam bets we never surfaced
//                           because we were locked onto a different horse?
//
// Booking lives in the autobook scanner (Engine.scanLateModel), not evaluate() —
// evaluate returns null so the one-pick-per-race stage loop ignores these. One
// race can surface several bets; each gets its own shadow ticket. The late crush
// % is stored in stagedEV (like pure-steam) so analysis can slice the model-only
// sweep by whether the horse was also steaming.

export const LATE_SCAN_ID = "tvg-late-scan";
export const LATE_STEAM_SCAN_ID = "tvg-late-steam-scan";

// Only scan the last minute before post — this is the "last possible second"
// re-read. Once-per-(race,horse) dedup means the first qualifying tick in this
// window books it; ticks are ~10s apart so we get the latest model read while
// still leaving time to place.
export const LATE_WINDOW_MS = 60_000;
export const MIN_SECONDS_TO_POST = 15;      // don't book inside T-15s (unplaceable)
export const MAX_ODDS = 60;                 // ignore bombs / stale prices
export const MIN_FIELD = 3;                 // same field floor as tvg-baseline
// "Major" edge: model EV at/above this books a REAL bet; below it (down to the
// config evThreshold) books shadow so the sweep is measured without loading the
// book with marginal, correlated picks. Well above tvg-baseline's +10% fire bar
// — tune here as the forward record accrues.
export const REAL_EV_FLOOR = 25;
const FALLBACK_TAKEOUT = 0.16;
// Window for the best-effort crush stat: odds as they stood 6min out vs now.
const CRUSH_WINDOW_MS = 6 * 60_000;
const STEAM_BAND: readonly [number, number] = [15, 35];

export interface LateModelBet {
  program: string;
  name: string;
  odds: number;           // current (fire-moment) decimal odds
  fractionalOdds: string;
  ev: number;             // calibrated model EV % at current odds
  trueP: number;          // calibrated model P
  crushPct: number;       // late crush %, best-effort (NaN if no history)
}

// Best-effort late crush: last history point at/before window-open vs now.
// Returns NaN when there isn't enough history to judge movement.
function lateCrushPct(r: Runner, postTime: number): number {
  const hist = r.oddsHistory;
  if (!hist || hist.length < 2) return Number.NaN;
  const windowOpenT = postTime - CRUSH_WINDOW_MS;
  let ref = hist[0];
  for (const h of hist) {
    if (h.t <= windowOpenT) ref = h;
    else break;
  }
  if (ref.odds <= 0) return Number.NaN;
  return ((ref.odds - r.currentOdds) / ref.odds) * 100;
}

// Field-wide late model read. `crushBand` (when set) additionally requires the
// runner to have crushed into [lo, hi] — the steam-recheck variant. `now` is
// passed in (no Date.now()) so it stays deterministic/testable.
export function detectLateModelBets(
  race: Race,
  now: number,
  evThreshold: number,
  crushBand?: readonly [number, number],
): LateModelBet[] {
  const msToPost = race.postTime - now;
  if (msToPost < MIN_SECONDS_TO_POST * 1000) return []; // too late to place
  if (msToPost > LATE_WINDOW_MS) return [];             // not in the last-second window yet
  if (race.statusCode === "SK") return [];             // race is off
  if (race.modelQuality !== "high") return [];         // same model-quality gate as tvg-baseline

  const live = race.runners.filter(r => !r.scratched && r.currentOdds > 1 && r.currentOdds < MAX_ODDS);
  if (live.length < MIN_FIELD) return [];

  const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
  const out: LateModelBet[] = [];
  for (const r of live) {
    if (r.truePWin == null) continue;
    const marketP = 1 / Math.max(1.2, r.currentOdds);
    const calibP = calibrateTVGBaselineTrueP(r.truePWin, marketP);
    const ev = evPercentFromTrueP(calibP, r.currentOdds, takeout);
    if (ev < evThreshold) continue;
    const crushPct = lateCrushPct(r, race.postTime);
    if (crushBand) {
      // Steam-recheck: must have confirmed movement into the band. No history →
      // can't confirm → skip.
      if (Number.isNaN(crushPct) || crushPct < crushBand[0] || crushPct > crushBand[1]) continue;
    }
    out.push({
      program: r.program,
      name: r.name,
      odds: r.currentOdds,
      fractionalOdds: r.fractionalOdds,
      ev,
      trueP: calibP,
      crushPct,
    });
  }
  return out;
}

// Scanner specs the autobook iterates. Kept here next to the detector so the
// crush-band coupling stays in one place.
export const LATE_SCAN_SPECS: ReadonlyArray<{ id: string; crushBand?: readonly [number, number] }> = [
  { id: LATE_SCAN_ID },
  { id: LATE_STEAM_SCAN_ID, crushBand: STEAM_BAND },
];

export const lateScanStrategy: Strategy = {
  id: LATE_SCAN_ID,
  name: "TVG Late Field Scan",
  thesis:
    "At the last second, re-run the model across the whole field: book major +EV runners for real, shadow the rest. The field-wide counterfactual to tvg-baseline's one early pick.",
  appliesTo: ["thoroughbred"],
  evaluate() {
    return null;
  },
};

export const lateSteamScanStrategy: Strategy = {
  id: LATE_STEAM_SCAN_ID,
  name: "TVG Late Steam Scan",
  thesis:
    "At the last second, take every runner the model likes (+EV) that has ALSO steamed into the 15-35% band: major edges real, rest shadow. The field-wide counterfactual to tvg-steam's one confirmed pick.",
  appliesTo: ["thoroughbred"],
  evaluate() {
    return null;
  },
};
