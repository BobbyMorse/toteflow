import type { Strategy } from "./types";

// Pure-steam CONTROL (measure-only, no model). The whole point is to isolate
// what tvg-steam's MODEL actually contributes. tvg-steam = model-divergent pick
// + 15-35% crush confirmation. This strategy keeps the identical crush gate but
// throws the model away: it stages the plain market FAVORITE and fires only if
// the crowd hammers that favorite a further 15-35% by post.
//
// The experiment it settles:
//   - pure-steam shadow ROI ≈ tvg-steam ROI  → the model adds nothing; the edge
//     (if any) is pure "follow the confirmed money", and all the calibration
//     machinery can go.
//   - pure-steam clearly worse                → the model's SELECTION is doing
//     real work beyond the steam signal, and it's worth keeping.
//
// Runs measure-only (zero real stake, fully-graded shadowPL) so it costs nothing
// to run alongside the live book and never adds to real-money volume.
//
// PRE-REGISTERED 2026-07-19: the band [15,35], the universe (thoroughbred,
// field >= 5, favorite = shortest live price), and the measure-only stake basis
// were all fixed BEFORE any forward data was collected. Do not tune these to
// results — the point of a separate id is to measure the pre-registered rule
// out-of-sample. If it looks good, it has to look good on data gathered AFTER
// today, not on a re-slice of the cohort that inspired it.

const MIN_SECONDS_TO_POST = 15;
const STEAM_BAND: readonly [number, number] = [15, 35];
const MIN_FIELD = 5;
const MAX_ODDS = 60; // ignore bombs / stale prices, same guard as tvg-baseline

export const pureSteamStrategy: Strategy = {
  id: "pure-steam",
  name: "Pure Steam (control · no model)",
  thesis:
    "Back the market favorite and fire only once late money crushes it a further 15-35%. No model — isolates whether steam confirmation alone carries the edge.",
  appliesTo: ["thoroughbred"],
  measureOnly: true,
  noEvThesis: true,
  fireCrushBand: STEAM_BAND,
  evaluate(race) {
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;
    const live = race.runners.filter(
      r => !r.scratched && r.currentOdds > 1 && r.currentOdds < MAX_ODDS,
    );
    if (live.length < MIN_FIELD) return null;

    // Market favorite = shortest live price. This is the crowd's pick, not the
    // model's; the fireCrushBand gate at promote decides whether the late money
    // confirms it enough to actually fire.
    let fav = live[0];
    for (const r of live) if (r.currentOdds < fav.currentOdds) fav = r;

    return {
      selection: fav.program,
      type: "WIN",
      evPercent: 0, // no EV claim — pure market control (see noEvThesis)
      confidence: 0.5,
      reason:
        `Pure-steam control: favorite ${fav.name} @ ${fav.fractionalOdds} — ` +
        `fire only if crushed ${STEAM_BAND[0]}-${STEAM_BAND[1]}% by post (no model)`,
    };
  },
};
