import type { Strategy } from "./types";
import type { Discipline } from "../track-types";
import {
  calibrateTVGBaselineTrueP,
  calibrateTVGBaselineHarnessTrueP,
  calibrateTVGBaselineQHTrueP,
  calibrateTVGBaselineJumpsTrueP,
  evPercentFromTrueP,
} from "../strategy-calibration";

const MIN_SECONDS_TO_POST = 15;
const FALLBACK_TAKEOUT = 0.16;

// Empirical calibration. The TVG adapter's trueP blend gives the model 65%
// weight on "high" quality races and 35% to market, then computes EV at
// current odds. Thoroughbred: 159 bets, -21% ROI on the raw 0.65 weight,
// re-blended down to 0.30 → +12.6% ROI (audit 2026-06-29). Harness at the
// same 0.30 weight is -64.6% over 68 bets — TVG's model is thoroughbred-fit
// and overrates harness picks, so harness runs at 0.15. QH matches harness
// until we have data to fit its own. Weights and per-variant calibrators
// live in lib/strategy-calibration.ts so the tickets page can recompute
// the same trueP for live displays.

type TrueP = (adapterTrueP: number, marketP: number) => number;

function build(id: string, name: string, appliesTo: Discipline[], calibrate: TrueP): Strategy {
  return {
    id,
    appliesTo,
    name,
    thesis: "Trust TVG's winProbability when modelQuality === 'high', calibrated against realized P/L.",
    evaluate(race) {
      if (race.modelQuality !== "high") return null;
      const secondsToPost = (race.postTime - Date.now()) / 1000;
      if (secondsToPost < MIN_SECONDS_TO_POST) return null;
      const live = race.runners.filter(r => !r.scratched && r.currentOdds < 60);
      if (live.length < 3) return null;

      const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
      type Candidate = { runner: typeof live[number]; ev: number; trueP: number };
      let best: Candidate | null = null;
      for (const r of live) {
        if (r.truePWin == null) continue;
        const marketP = 1 / Math.max(1.2, r.currentOdds);
        const calibP = calibrate(r.truePWin, marketP);
        const ev = evPercentFromTrueP(calibP, r.currentOdds, takeout);
        if (ev > 0 && (best == null || ev > best.ev)) best = { runner: r, ev, trueP: calibP };
      }
      if (!best) return null;

      // P, EV, and odds here all come from the same evPercentFromTrueP call
      // above, so the returned pair is consistent by construction. Historical
      // "impossible pairs" (e.g. P=9.1% with EV=+24.2%) were caused by
      // autobook capturing P and EV at different odds snapshots — fixed in
      // promoteStagedTickets by pairing re-eval P with re-eval EV atomically.
      return {
        selection: best.runner.program,
        type: "WIN",
        evPercent: best.ev,
        truePWin: best.trueP,
        reason: `TVG model P=${(best.trueP * 100).toFixed(1)}% → EV +${best.ev.toFixed(1)}% on ${best.runner.name} (model: high, calibrated)`,
        confidence: 0.6,
      };
    },
  };
}

export const tvgBaselineStrategy: Strategy = build(
  "tvg-baseline", "TVG Model Baseline", ["thoroughbred"], calibrateTVGBaselineTrueP,
);

export const tvgBaselineHarnessStrategy: Strategy = build(
  "tvg-baseline-harness", "TVG Model Baseline (Harness)", ["harness"], calibrateTVGBaselineHarnessTrueP,
);

export const tvgBaselineQHStrategy: Strategy = build(
  "tvg-baseline-qh", "TVG Model Baseline (QH)", ["quarter-horse"], calibrateTVGBaselineQHTrueP,
);

export const tvgBaselineJumpsStrategy: Strategy = build(
  "tvg-baseline-jumps", "TVG Model Baseline (Jumps)", ["jumps"], calibrateTVGBaselineJumpsTrueP,
);

// Steam-confirm variants: same divergence entry as tvg-baseline, but only
// FIRE when the market has partially confirmed the pick — live odds down
// 15-35% from stage-time odds. Empirical basis (2026-07-17 audit, 1,136
// settled WIN bets, tote-settled): stage→fire crush 15-35% cohort ran +56.5%
// ROI (n=132; tvg-baseline* subset +61.5%, n=106), while >35% crush was
// negative (payout destroyed even though win% keeps climbing) and un-crushed
// picks hovered near breakeven. Winners' median fire→close CLV was +58.6%
// vs +12.5% for losers — the model's live picks attract late money, and the
// moderate-crush window is where confirmation exists but price still pays.
// Forward test of a post-hoc cohort finding — expect regression toward the
// mean; the point of a separate strategy id is measuring exactly that.
const STEAM_BAND: readonly [number, number] = [15, 35];
const STEAM_THESIS =
  "Stage on model-market divergence, fire only once late money has moved the pick 15-35% toward the model's price.";

export const tvgSteamStrategy: Strategy = {
  ...build("tvg-steam", "TVG Steam Confirm", ["thoroughbred"], calibrateTVGBaselineTrueP),
  thesis: STEAM_THESIS,
  fireCrushBand: STEAM_BAND,
};

export const tvgSteamHarnessStrategy: Strategy = {
  ...build("tvg-steam-harness", "TVG Steam Confirm (Harness)", ["harness"], calibrateTVGBaselineHarnessTrueP),
  thesis: STEAM_THESIS,
  fireCrushBand: STEAM_BAND,
};

// -------- Steam variants (all measure-only) --------
// tvg-steam fires on crush MAGNITUDE alone (15-35% band) and never checks
// whether the pick is still underpriced after the move. These three isolate
// that gap. They run as measure-only shadows so they accumulate a fully-graded
// track record beside the live book without splitting real stake or colliding
// with tvg-steam's real bets on the same picks (bankroll dedup would shadow one
// of them anyway). Promote a winner to real money by flipping measureOnly off.

// WIN closing/projected EV for an already-selected pick, priced against a given
// pool at the SAME model weight the bet fired on. Used by the closing-EV gate
// (against the closing pool) — routed through the strategy so discipline
// variants reprice consistently. Returns null when the pick can't be priced.
function winEVForSelection(
  race: Parameters<Strategy["evaluate"]>[0],
  selections: readonly string[],
  calibrate: TrueP,
): number | null {
  const prog = selections[0];
  const r = race.runners.find(x => x.program === prog);
  if (!r || r.scratched || r.truePWin == null || r.currentOdds < 1.2) return null;
  const takeout = race.takeout > 0 ? race.takeout : FALLBACK_TAKEOUT;
  const marketP = 1 / Math.max(1.2, r.currentOdds);
  return evPercentFromTrueP(calibrate(r.truePWin, marketP), r.currentOdds, takeout);
}

// #1 — the real hypothesis: steam + value STILL remaining. Same crush band, but
// only fire when EV re-priced at the projected closing price still clears
// threshold. This is the guidance's rule: ev = fair_p·(expected_close+1) − 1 > t.
// Major-edge floor: fires at/above this book REAL, below it book shadow.
// Matches the late scanners' REAL_EV_FLOOR (lib/strategies/late-scan.ts).
const MAJOR_EV_FLOOR = 25;

export const tvgSteamValueStrategy: Strategy = {
  ...build("tvg-steam-value", "TVG Steam + Value", ["thoroughbred"], calibrateTVGBaselineTrueP),
  thesis:
    "Steam-confirm entry, but fire only when the pick is still +EV at its projected closing price — bet the move only while the horse is still underpriced. Books major edges real, shadows the rest.",
  fireCrushBand: STEAM_BAND,
  projectedEVMode: "require-positive",
  realEVFloor: MAJOR_EV_FLOOR,
};

// #2 — the negative control: steam that has already OVERSHOT fair value. Same
// crush band, fires only when projected-close EV has gone negative. If #1 pays
// and this bleeds, the edge is value-survival, not the move itself.
export const tvgSteamOverbetStrategy: Strategy = {
  ...build("tvg-steam-overbet-guard", "TVG Steam Overbet (control)", ["thoroughbred"], calibrateTVGBaselineTrueP),
  thesis:
    "Negative control: steam-confirm entry that fires only when the price has overshot fair value (projected-close EV < 0). Expected to lose — isolates whether the payoff is value-survival or just the move. Measure-only.",
  fireCrushBand: STEAM_BAND,
  projectedEVMode: "require-negative",
  measureOnly: true,
};

// #3 — plain steam, self-grading on the CLOSE. Fires exactly like tvg-steam, but
// opts into closing-EV stamping: the snapshotter re-prices this exact pick on
// the closing pool and stores it as closingStrategyEV on the (shadow) ticket.
// Since it's measure-only every fire is already shadow, so the grader doesn't
// reclassify — instead the stamped closing EV lets analysis split its shadow P&L
// into "value survived to the close" vs "didn't", answering whether close-
// surviving steamers are the ones that actually win.
export const tvgSteamClosingGateStrategy: Strategy = {
  ...build("tvg-steam-closing-gate", "TVG Steam + Close EV", ["thoroughbred"], calibrateTVGBaselineTrueP),
  thesis:
    "Plain steam-confirm that books major edges real, then re-prices its own EV on the closing pool — the closing-EV gate reclassifies any real bet whose value didn't survive to the close as shadow. Sub-major fires shadow but still record their closing EV.",
  fireCrushBand: STEAM_BAND,
  gateOnClosingEV: true,
  closingEVFor(race, selections) {
    return winEVForSelection(race, selections, calibrateTVGBaselineTrueP);
  },
  realEVFloor: MAJOR_EV_FLOOR,
};
