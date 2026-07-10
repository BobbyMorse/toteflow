import type { Strategy } from "./types";

// Pipeline-test strategy: always bets the favorite on any race that has one.
// Not a real edge — favorites are roughly fair (-takeout EV). Useful to
// confirm the book → snapshot → grade → CLV → leaderboard flow end-to-end.

export const alwaysFavoriteStrategy: Strategy = {
  id: "always-fav",
  appliesTo: ["thoroughbred"],
  name: "Always Favorite (test)",
  thesis: "Bets the favorite on every race. Pipeline-verification strategy, not a real edge.",
  evaluate(race) {
    const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
    if (live.length < 2) return null;
    const fav = live.reduce((a, b) => b.currentOdds < a.currentOdds ? b : a, live[0]);
    return {
      selection: fav.program,
      type: "WIN",
      evPercent: 0,
      reason: `Test: favorite #${fav.program} ${fav.name} @ ${fav.fractionalOdds}`,
      confidence: 0.5,
    };
  },
};
