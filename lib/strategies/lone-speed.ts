import type { Strategy } from "./types";

// Lone-speed scenarios: when one horse projects to be loose on an uncontested
// early lead, it wins more often than its odds suggest. Identifying lone
// speed requires running-style classifications (E/EP/P/S) computed from
// past-performance pace figures. We don't have that data wired up yet.
// Registered here so the framework is complete; will produce real picks
// once a PP/pace feed is plugged in.

export const loneSpeedStrategy: Strategy = {
  id: "lone-speed",
  appliesTo: ["thoroughbred"],
  name: "Lone Speed",
  thesis: "Bet the only E/EP-rated horse when no other front-runner is in the race.",
  evaluate() {
    return null;
  },
};
