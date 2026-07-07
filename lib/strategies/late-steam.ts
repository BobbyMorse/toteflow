import type { Strategy } from "./types";
import { classifyTrack, isThoroughbred } from "../track-types";

// Sharp money concentrates in the last minute before post. A runner whose
// odds dropped sharply in the closing seconds is being backed by people who
// believe they know something. Riding that move is well-documented as +EV
// on liquid markets — but on tiny pools, a single late bet can cause the
// same signal without any real information, so we require minimum pool size.

const FALLBACK_TAKEOUT = 0.16;  // US WIN average; only used if race.takeout missing
const MIN_DROP_PCT = 0.12;       // current must be ≥12% lower than 60s-ago
const MIN_WIN_POOL = 25_000;
const LOOKBACK_MS = 60_000;
const MIN_SECONDS_TO_POST = 60;  // late-steam is chaos-phase; tighter window OK

export const lateSteamStrategy: Strategy = {
  id: "late-steam",
  name: "Late Steam",
  thesis: "Bet runners whose odds dropped 12%+ in the last 60s on liquid pools.",
  evaluate(race) {
    if (race.phase !== "chaos" && race.phase !== "action") return null;
    if (!isThoroughbred(classifyTrack(race.trackCode, race.track))) return null;
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;
    if (race.winPoolTotal < MIN_WIN_POOL) return null;

    const now = Date.now();
    const candidates = race.runners
      .filter(r => !r.scratched && r.currentOdds < 60 && r.oddsHistory.length >= 2)
      .map(r => {
        const cutoff = now - LOOKBACK_MS;
        const old = r.oddsHistory.find(h => h.t >= cutoff) ?? r.oddsHistory[0];
        const drop = (old.odds - r.currentOdds) / old.odds;
        return { r, drop, fromOdds: old.odds };
      })
      .filter(c => c.drop >= MIN_DROP_PCT)
      .sort((a, b) => b.drop - a.drop);
    if (!candidates.length) return null;

    const { r: best, drop, fromOdds } = candidates[0];
    const marketP = 1 / best.currentOdds;
    // Assume the steam reflects real info — adjust probability up by half the drop
    const adjustedP = Math.min(0.85, marketP * (1 + drop * 0.5));
    const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
    const ev = (adjustedP * (best.currentOdds - 1) * (1 - takeout) - (1 - adjustedP)) * 100;
    if (ev <= 0) return null;

    return {
      selection: best.program,
      type: "WIN",
      evPercent: ev,
      reason: `Steam: ${best.name} ${fromOdds.toFixed(1)} → ${best.currentOdds.toFixed(1)} (-${(drop * 100).toFixed(0)}% in 60s)`,
      confidence: Math.min(0.65, 0.3 + drop),
    };
  },
};
