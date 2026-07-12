import type { Strategy } from "./types";

// Heavy favorites (sub-2.0 decimal, i.e. odds-on) are statistically over-bet
// in deep fields. Public piles on low-price favorites; sharps fade.
// Bet 2nd choice as a value play when this pattern shows up.

const FALLBACK_TAKEOUT = 0.16;  // US WIN average; only used if race.takeout missing
// Documented edge from historical studies: heavy favs in fields ≥8 are
// overbet by roughly 3-5 percentage points of implied win probability.
const FAV_OVERBET_BIAS = 0.04;
const MIN_SECONDS_TO_POST = 15;

export const favFadeStrategy: Strategy = {
  id: "fav-fade",
  appliesTo: ["thoroughbred"],
  name: "Heavy-Favorite Fade",
  thesis: "Bet the 2nd choice when the favorite is <2.0 (1-1) in fields of 8+.",
  evaluate(race) {
    const secondsToPost = (race.postTime - Date.now()) / 1000;
    if (secondsToPost < MIN_SECONDS_TO_POST) return null;
    const live = race.runners
      .filter(r => !r.scratched && r.currentOdds < 60)
      .sort((a, b) => a.currentOdds - b.currentOdds);
    if (live.length < 8) return null;
    const fav = live[0];
    const second = live[1];
    if (fav.currentOdds >= 2.0) return null;
    if (!second || second.currentOdds < 2.5 || second.currentOdds > 12) return null;

    const marketP = 1 / second.currentOdds;
    // Borrowed implied probability from the favorite based on the overbet bias
    const adjustedP = marketP + FAV_OVERBET_BIAS * (1 / fav.currentOdds);
    const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
    const ev = (adjustedP * (second.currentOdds - 1) * (1 - takeout) - (1 - adjustedP)) * 100;
    if (ev <= 0) return null;

    return {
      selection: second.program,
      type: "WIN",
      evPercent: ev,
      reason: `Fade fav ${fav.fractionalOdds}; 2nd choice ${second.name} @ ${second.fractionalOdds} (field ${live.length})`,
      confidence: 0.4,
    };
  },
};
