import type { Strategy } from "./types";

// Never fires. Used as a control group — if your active strategies aren't
// beating "do nothing", you have no edge.

export const passControlStrategy: Strategy = {
  id: "pass-control",
  name: "Pass Control",
  thesis: "Never bets. If active strategies don't beat $0 P/L, none of them work.",
  evaluate() {
    return null;
  },
};
