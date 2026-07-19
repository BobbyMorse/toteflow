// Closing-line backtest — the one experiment that gates a model-driven CAW:
// does blending our model (truePWin) into the closing market beat the closing
// market at predicting winners, and does anything clear takeout on real payoffs?
//
// This runs field-wide (every stamped runner in runner_snapshots), so it's free
// of the bet-selection bias that ticket-level analytics carry. The blend weight
// is fit on a TIME-ORDERED train split and evaluated on a later held-out test
// split, so "the model helps" can't be an artifact of fitting and scoring on the
// same races.
//
// Payoff units: runner_snapshots.winPayoff is stored PER $1 (see
// runner-snapshots.ts — TVG reports per betAmount, we divide it out). A winning
// $1 bet returns winPayoff dollars TOTAL (stake included); profit = winPayoff-1.

import type BetterSqlite3 from "better-sqlite3";

export interface SnapRunner {
  program: string;
  odds: number;          // closing win odds (decimal)
  truePWin: number;      // model win prob
  winPayoffPer1: number | null; // realized $/$1 if it won
  finishPosition: number;
  q?: number;            // normalized market prob (filled by normalizeRace)
  p?: number;            // normalized model prob
}
export interface SnapRace {
  key: string;
  postTime: number;
  fieldSize: number;
  modelQuality: string | null;
  runners: SnapRunner[];
}

export interface BacktestOptions {
  minField?: number;     // default 5
  trainFrac?: number;    // default 0.7 (earliest races train, latest test)
  betBase?: number;      // flat stake per bet, default 1
  bootstrap?: number;    // resamples for test-set CIs, default 2000
}

// ---- Load field-wide settled snapshots, grouped into clean races ----
export function loadRacesFromDb(db: BetterSqlite3.Database, minField = 5): SnapRace[] {
  const rows = db.prepare(`
    SELECT raceId, day, program, odds, truePWin, winPayoff, finishPosition,
           postTime, fieldSize, modelQuality
    FROM runner_snapshots
    WHERE finishPosition IS NOT NULL AND odds IS NOT NULL AND odds > 1
      AND truePWin IS NOT NULL AND scratched = 0
  `).all() as Array<{
    raceId: string; day: string; program: string; odds: number; truePWin: number;
    winPayoff: number | null; finishPosition: number; postTime: number | null;
    fieldSize: number | null; modelQuality: string | null;
  }>;

  const byRace = new Map<string, SnapRace>();
  for (const r of rows) {
    const key = `${r.raceId}|${r.day}`;
    let race = byRace.get(key);
    if (!race) {
      race = {
        key, postTime: r.postTime ?? 0, fieldSize: r.fieldSize ?? 0,
        modelQuality: r.modelQuality, runners: [],
      };
      byRace.set(key, race);
    }
    race.runners.push({
      program: r.program, odds: r.odds, truePWin: r.truePWin,
      winPayoffPer1: r.winPayoff, finishPosition: r.finishPosition,
    });
  }

  // Keep races with exactly one winner and a real field.
  const clean: SnapRace[] = [];
  for (const race of byRace.values()) {
    if (race.runners.length < minField) continue;
    if (race.runners.filter(x => x.finishPosition === 1).length !== 1) continue;
    normalizeRace(race);
    clean.push(race);
  }
  // Time order so the split is genuinely out-of-sample forward in time.
  clean.sort((a, b) => a.postTime - b.postTime);
  return clean;
}

// Overround-removed market prob (q) and renormalized model prob (p) per race.
function normalizeRace(race: SnapRace): void {
  const invSum = race.runners.reduce((a, r) => a + 1 / r.odds, 0);
  const pSum = race.runners.reduce((a, r) => a + Math.max(0, r.truePWin), 0);
  for (const r of race.runners) {
    r.q = (1 / r.odds) / invSum;
    r.p = pSum > 0 ? Math.max(0, r.truePWin) / pSum : 1 / race.runners.length;
  }
}

// Per-race multiclass log-loss of a blend w·p + (1-w)·q (renormalized).
function raceLogLoss(race: SnapRace, w: number): number {
  const bl = race.runners.map(r => w * (r.p ?? 0) + (1 - w) * (r.q ?? 0));
  const Z = bl.reduce((a, b) => a + b, 0) || 1;
  const iWin = race.runners.findIndex(r => r.finishPosition === 1);
  return -Math.log(Math.max(1e-9, bl[iWin] / Z));
}
function raceBrier(race: SnapRace, w: number): number {
  const bl = race.runners.map(r => w * (r.p ?? 0) + (1 - w) * (r.q ?? 0));
  const Z = bl.reduce((a, b) => a + b, 0) || 1;
  let s = 0;
  race.runners.forEach((r, i) => {
    const pb = bl[i] / Z;
    const won = r.finishPosition === 1 ? 1 : 0;
    s += (pb - won) ** 2;
  });
  return s / race.runners.length;
}
const meanLogLoss = (races: SnapRace[], w: number) =>
  races.reduce((a, r) => a + raceLogLoss(r, w), 0) / (races.length || 1);
const meanBrier = (races: SnapRace[], w: number) =>
  races.reduce((a, r) => a + raceBrier(r, w), 0) / (races.length || 1);

// ---- ROI rules. Each returns the set of (race, runner) picks. Settled at the
// real per-$1 win payoff. ----
type Rule = { label: string; pick: (r: SnapRunner, race: SnapRace) => boolean };
function argmaxProg(race: SnapRace, key: "p" | "q"): string {
  let best = race.runners[0];
  for (const r of race.runners) if ((r[key] ?? 0) > (best[key] ?? 0)) best = r;
  return best.program;
}
const RULES: Rule[] = [
  { label: "model overlay p>q", pick: (r) => (r.p ?? 0) > (r.q ?? 0) },
  { label: "overlay p>q*1.15", pick: (r) => (r.p ?? 0) > (r.q ?? 0) * 1.15 },
  { label: "overlay p>q*1.30", pick: (r) => (r.p ?? 0) > (r.q ?? 0) * 1.30 },
  { label: "always market favorite", pick: (r, race) => r.program === argmaxProg(race, "q") },
  { label: "always model top pick", pick: (r, race) => r.program === argmaxProg(race, "p") },
  { label: "bet every runner", pick: () => true },
];

interface RoiResult {
  label: string; bets: number; wins: number; winPct: number;
  staked: number; profit: number; roi: number;
  roiCiLo: number | null; roiCiHi: number | null;
}

function roiForRule(races: SnapRace[], rule: Rule, betBase: number, bootstrap: number): RoiResult {
  // Per-race profit so the bootstrap can resample whole races (bets within a
  // race are correlated — one winner per race).
  const perRace: Array<{ staked: number; profit: number; bets: number; wins: number }> = [];
  for (const race of races) {
    let staked = 0, profit = 0, bets = 0, wins = 0;
    for (const r of race.runners) {
      if (!rule.pick(r, race)) continue;
      bets++; staked += betBase;
      if (r.finishPosition === 1) {
        wins++;
        profit += (r.winPayoffPer1 != null ? r.winPayoffPer1 * betBase : betBase) - betBase;
      } else {
        profit += -betBase;
      }
    }
    perRace.push({ staked, profit, bets, wins });
  }
  const tot = perRace.reduce((a, x) => ({
    staked: a.staked + x.staked, profit: a.profit + x.profit,
    bets: a.bets + x.bets, wins: a.wins + x.wins,
  }), { staked: 0, profit: 0, bets: 0, wins: 0 });
  const roi = tot.staked > 0 ? tot.profit / tot.staked : 0;

  // Bootstrap ROI CI by resampling races with replacement.
  let ciLo: number | null = null, ciHi: number | null = null;
  const withBets = perRace.filter(x => x.staked > 0);
  if (bootstrap > 0 && withBets.length > 1) {
    const rois: number[] = [];
    for (let b = 0; b < bootstrap; b++) {
      let s = 0, p = 0;
      for (let i = 0; i < withBets.length; i++) {
        const x = withBets[(Math.random() * withBets.length) | 0];
        s += x.staked; p += x.profit;
      }
      if (s > 0) rois.push(p / s);
    }
    rois.sort((a, b) => a - b);
    ciLo = rois[Math.floor(0.025 * rois.length)] ?? null;
    ciHi = rois[Math.floor(0.975 * rois.length)] ?? null;
  }
  return {
    label: rule.label, bets: tot.bets, wins: tot.wins,
    winPct: tot.bets ? tot.wins / tot.bets : 0,
    staked: tot.staked, profit: tot.profit, roi, roiCiLo: ciLo, roiCiHi: ciHi,
  };
}

export interface BacktestReport {
  nRaces: number; nRunners: number; avgField: number;
  nTrain: number; nTest: number;
  dateRange: { first: number; last: number };
  meanAbsModelMinusMarket: number;
  bestWTrain: number;
  blendCurveTrain: Array<{ w: number; logloss: number; brier: number }>;
  test: {
    marketLogLoss: number; blendLogLoss: number; modelLogLoss: number;
    marketBrier: number; blendBrier: number; modelBrier: number;
    logLossDeltaCi: { lo: number; hi: number } | null; // market - blend, >0 = blend better
    roi: RoiResult[];
  };
}

export function analyze(races: SnapRace[], opts: BacktestOptions = {}): BacktestReport {
  const trainFrac = opts.trainFrac ?? 0.7;
  const betBase = opts.betBase ?? 1;
  const bootstrap = opts.bootstrap ?? 2000;

  const nRunners = races.reduce((a, r) => a + r.runners.length, 0);
  let sumAbs = 0, n = 0;
  for (const race of races) for (const r of race.runners) { sumAbs += Math.abs((r.p ?? 0) - (r.q ?? 0)); n++; }

  const split = Math.floor(races.length * trainFrac);
  const train = races.slice(0, split);
  const test = races.slice(split);

  // Grid-search blend weight on train (log-loss).
  const blendCurveTrain: Array<{ w: number; logloss: number; brier: number }> = [];
  let bestW = 0, bestLL = Infinity;
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const ll = meanLogLoss(train, w);
    blendCurveTrain.push({ w, logloss: ll, brier: meanBrier(train, w) });
    if (ll < bestLL) { bestLL = ll; bestW = w; }
  }

  // Evaluate on held-out test.
  const marketLogLoss = meanLogLoss(test, 0);
  const blendLogLoss = meanLogLoss(test, bestW);
  const modelLogLoss = meanLogLoss(test, 1);

  // Bootstrap CI on (market - blend) per-race log-loss delta over test races.
  let logLossDeltaCi: { lo: number; hi: number } | null = null;
  if (bootstrap > 0 && test.length > 1) {
    const deltas = test.map(r => raceLogLoss(r, 0) - raceLogLoss(r, bestW));
    const means: number[] = [];
    for (let b = 0; b < bootstrap; b++) {
      let s = 0;
      for (let i = 0; i < deltas.length; i++) s += deltas[(Math.random() * deltas.length) | 0];
      means.push(s / deltas.length);
    }
    means.sort((a, b) => a - b);
    logLossDeltaCi = {
      lo: means[Math.floor(0.025 * means.length)],
      hi: means[Math.floor(0.975 * means.length)],
    };
  }

  return {
    nRaces: races.length, nRunners, avgField: races.length ? nRunners / races.length : 0,
    nTrain: train.length, nTest: test.length,
    dateRange: { first: races[0]?.postTime ?? 0, last: races[races.length - 1]?.postTime ?? 0 },
    meanAbsModelMinusMarket: n ? sumAbs / n : 0,
    bestWTrain: bestW,
    blendCurveTrain,
    test: {
      marketLogLoss, blendLogLoss, modelLogLoss,
      marketBrier: meanBrier(test, 0), blendBrier: meanBrier(test, bestW), modelBrier: meanBrier(test, 1),
      logLossDeltaCi,
      roi: RULES.map(rule => roiForRule(test, rule, betBase, bootstrap)),
    },
  };
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const d = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "?");

export function formatReport(r: BacktestReport): string {
  const L: string[] = [];
  L.push(`CLOSING-LINE BACKTEST  (field-wide runner_snapshots)`);
  L.push(`Races ${r.nRaces}  Runners ${r.nRunners}  avg field ${r.avgField.toFixed(1)}  ` +
         `[${d(r.dateRange.first)} → ${d(r.dateRange.last)}]`);
  L.push(`Time-ordered split: train ${r.nTrain} races → test ${r.nTest} races`);
  L.push(`Mean |model - market| per runner: ${r.meanAbsModelMinusMarket.toFixed(4)}  (0 = model IS the market)`);
  L.push("");
  L.push(`1) Blend weight fit on TRAIN (0 = pure close, 1 = pure model), log-loss:`);
  for (const c of r.blendCurveTrain) {
    if (Math.round(c.w * 20) % 2 !== 0) continue; // print every 0.1
    const mark = c.w === r.bestWTrain ? "  <- min" : "";
    L.push(`   w=${c.w.toFixed(2)}   logloss ${c.logloss.toFixed(4)}   brier ${c.brier.toFixed(5)}${mark}`);
  }
  L.push(`   -> best w on train: ${r.bestWTrain.toFixed(2)}`);
  L.push("");
  L.push(`2) Held-out TEST — does blend@${r.bestWTrain.toFixed(2)} beat the pure close?`);
  L.push(`   log-loss:  market ${r.test.marketLogLoss.toFixed(4)}   blend ${r.test.blendLogLoss.toFixed(4)}   model ${r.test.modelLogLoss.toFixed(4)}`);
  L.push(`   brier:     market ${r.test.marketBrier.toFixed(5)}   blend ${r.test.blendBrier.toFixed(5)}   model ${r.test.modelBrier.toFixed(5)}`);
  if (r.test.logLossDeltaCi) {
    const { lo, hi } = r.test.logLossDeltaCi;
    const verdict = lo > 0 ? "blend beats close (CI excludes 0)"
      : hi < 0 ? "close beats blend (CI excludes 0)"
      : "no difference (CI spans 0)";
    L.push(`   (market - blend) log-loss delta, 95% CI: [${lo.toFixed(4)}, ${hi.toFixed(4)}]  -> ${verdict}`);
  }
  L.push("");
  L.push(`3) TEST ROI — flat $1 win bets, settled at REAL per-$1 tote payoff:`);
  L.push(`   rule                     bets   win%     ROI      95% CI`);
  for (const x of r.test.roi) {
    const ci = x.roiCiLo != null ? `[${pct(x.roiCiLo)}, ${pct(x.roiCiHi!)}]` : "—";
    L.push(`   ${x.label.padEnd(24)} ${String(x.bets).padStart(4)}  ${(x.winPct * 100).toFixed(1).padStart(5)}%  ${pct(x.roi).padStart(7)}   ${ci}`);
  }
  return L.join("\n");
}
