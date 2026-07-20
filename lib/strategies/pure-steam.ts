import type { Race, Runner } from "../types";
import type { Strategy } from "./types";

// Pure-steam SCANNER (measure-only, no model). A field-wide steam detector:
// every tick in the closing window it measures the % of LATE odds movement on
// EVERY live runner and books a measure-only paper bet on any horse whose price
// has crushed past the trigger. No model, no favorite bias — it bets whatever
// the money is confirming.
//
// The experiment it settles: does late market steam, by itself, predict winners
// and at what magnitude does the payoff survive? Compare its shadow ROI against
// tvg-steam (model pick + crush gate):
//   - pure-steam ≈ tvg-steam  → the model adds nothing; the edge is the steam.
//   - pure-steam worse        → the model's SELECTION is doing real work.
// And because it records the exact crush % on each ticket (stagedEV), analysis
// can bucket by magnitude and re-derive the payoff sweet spot out-of-sample —
// the 2026-07-17 audit put it at 15-35%; this measures whether that holds going
// forward and where it breaks.
//
// Measure-only: every fire is shadow (real stake/PL = 0, hypothetical in
// shadowPL) so it never touches the bankroll or adds to real-bet volume.
//
// Booking lives in the autobook scanner (Engine.scanSteam), not evaluate() —
// evaluate returns null so the normal one-pick-per-race stage loop ignores it.
// A single race can surface multiple steamers, and each gets its own bet.

export const PURE_STEAM_ID = "pure-steam";

// Late window: measure the crush from the odds as they stood when the race
// entered this window (T-WINDOW_MS) to now. Only scan/book inside it.
export const WINDOW_MS = 6 * 60_000;
// Don't book inside T-15s — a human couldn't place it. Matches tvg-baseline.
export const MIN_SECONDS_TO_POST = 15;
// Trigger floor: a horse must have shortened at least this much, late, to fire.
// No upper cap — we bet big crushes too and record the magnitude so analysis
// can confirm/deny the 35% "payout destroyed" ceiling forward, not gate on it.
export const TRIGGER_MIN_CRUSH_PCT = 15;
// Movement must span at least this much wall-clock so a single blip tick can't
// masquerade as steam.
export const MIN_MOVE_BASE_MS = 60_000;
export const MIN_FIELD = 5;
export const MAX_ODDS = 60; // ignore bombs / stale prices (same guard as baseline)

export interface SteamTrigger {
  program: string;
  name: string;
  odds: number;         // current (fire-moment) decimal odds
  refOdds: number;      // odds at the start of the late window
  fractionalOdds: string;
  crushPct: number;     // late movement %, (refOdds - odds) / refOdds * 100
}

// Odds at the start of the late window for a runner: the last history point at
// or before window-open, else the earliest point we have. Returns null when
// there isn't enough history (need ≥2 points spanning ≥ MIN_MOVE_BASE_MS).
function windowOpenOdds(runner: Runner, windowOpenT: number, now: number): { odds: number; t: number } | null {
  const hist = runner.oddsHistory;
  if (!hist || hist.length < 2) return null;
  let ref = hist[0];
  for (const h of hist) {
    if (h.t <= windowOpenT) ref = h;
    else break;
  }
  if (now - ref.t < MIN_MOVE_BASE_MS) return null;
  return { odds: ref.odds, t: ref.t };
}

// Pure detection — every live runner whose late crush clears the trigger.
// `now` is passed in (no Date.now() so it's deterministic/testable).
export function detectSteamTriggers(race: Race, now: number): SteamTrigger[] {
  const msToPost = race.postTime - now;
  if (msToPost < MIN_SECONDS_TO_POST * 1000) return []; // too late to place
  if (msToPost > WINDOW_MS) return [];                  // not in the late window yet
  if (race.statusCode === "SK") return [];              // race is off

  const live = race.runners.filter(r => !r.scratched && r.currentOdds > 1 && r.currentOdds < MAX_ODDS);
  if (live.length < MIN_FIELD) return [];

  const windowOpenT = race.postTime - WINDOW_MS;
  const out: SteamTrigger[] = [];
  for (const r of live) {
    const ref = windowOpenOdds(r, windowOpenT, now);
    if (!ref) continue;
    const crushPct = ((ref.odds - r.currentOdds) / ref.odds) * 100;
    if (crushPct < TRIGGER_MIN_CRUSH_PCT) continue;
    out.push({
      program: r.program,
      name: r.name,
      odds: r.currentOdds,
      refOdds: ref.odds,
      fractionalOdds: r.fractionalOdds,
      crushPct,
    });
  }
  return out;
}

// Registered so it has a config row and shows in the UI, but the real work is
// the autobook scanner. evaluate() returns null on purpose — pure-steam does
// not stage one pick per race; it books each steamer directly.
export const pureSteamStrategy: Strategy = {
  id: PURE_STEAM_ID,
  name: "Pure Steam (scanner · no model)",
  thesis:
    "Scan the whole field for late odds crush and paper-bet every horse that shortens ≥15% into post. No model — measures whether steam confirmation alone predicts winners.",
  appliesTo: ["thoroughbred"],
  measureOnly: true,
  evaluate() {
    return null;
  },
};
