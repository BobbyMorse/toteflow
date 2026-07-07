// Calibration diagnostics for WIN strategies. The point of this script is not
// to give a single P/L number (analyze.ts does that) but to answer:
//   1. Where does the model's predicted probability match reality, and where
//      does it drift?  (calibration curve)
//   2. Is favorite-longshot bias eating our ROI at specific odds ranges?
//   3. Does higher predicted EV actually translate to higher realized ROI, or
//      is the EV signal noise?
//
// Re-run after each batch of settled bets to watch calibration drift.
//
// Usage:
//   npx tsx scripts/calibration.ts
//   npx tsx scripts/calibration.ts --strategy tvg-baseline
//   npx tsx scripts/calibration.ts --strategy tvg-baseline --days 30

import Database from "better-sqlite3";
import path from "path";

const args = process.argv.slice(2);
const strategy = args.includes("--strategy") ? args[args.indexOf("--strategy") + 1] : "tvg-baseline";
const days = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : null;
const since = days ? Date.now() - days * 86_400_000 : 0;

// Ticket rows don't store takeout, so back-solving predicted probability from
// captured EV + odds needs an assumed rate. 0.16 matches the strategy's
// FALLBACK_TAKEOUT and is close to the US thoroughbred pool average (~15-19%).
// A misestimate here shifts the whole calibration curve uniformly — the SHAPE
// of the curve (which buckets over/underperform) is what matters and is
// insensitive to this choice.
const TAKEOUT = 0.16;

const db = new Database(path.join(process.cwd(), "data", "toteflow.db"), { readonly: true });

// Invert the strategy's EV formula:
//   EV/100 = p * (dec - 1) * (1 - t) - (1 - p)
// →  p     = (EV/100 + 1) / [(dec - 1) * (1 - t) + 1]
function recoverProb(ev: number, odds: number, takeout = TAKEOUT): number | null {
  if (!Number.isFinite(ev) || !Number.isFinite(odds) || odds <= 1) return null;
  const p = (ev / 100 + 1) / ((odds - 1) * (1 - takeout) + 1);
  if (p <= 0 || p >= 1) return null;
  return p;
}

interface Row {
  strategyId: string; type: string; status: string;
  stake: number; realizedPL: number;
  capturedEV: number; capturedOdds: number;
  closingOdds: number | null;
}

const rows = db.prepare(`
  SELECT strategyId, type, status, stake, realizedPL, capturedEV, capturedOdds, closingOdds
  FROM tickets
  WHERE status IN ('won','lost')
    AND type = 'WIN'
    AND strategyId = ?
    AND placedAt >= ?
`).all(strategy, since) as Row[];

console.log(`\n=== Calibration diagnostics: ${strategy} ===`);
console.log(`Sample: ${rows.length} settled WIN tickets since ${since ? new Date(since).toISOString().slice(0, 10) : "epoch"}`);
console.log(`Assumed takeout for p-recovery: ${(TAKEOUT * 100).toFixed(1)}%\n`);

if (rows.length === 0) {
  console.log("No settled tickets. Exiting.");
  db.close();
  process.exit(0);
}

// ---------- 1. Calibration curve: predicted prob → realized hit rate ----------
// If the model is well-calibrated, mean predicted P in each bucket should
// approximately equal the realized hit rate. Systematic overshoot in the
// low-probability (longshot) buckets is the fingerprint of the favorite-
// longshot bias the tvg-baseline audit called out.
const PROB_BUCKETS = [
  { lo: 0.00, hi: 0.05, label: "0-5%" },
  { lo: 0.05, hi: 0.10, label: "5-10%" },
  { lo: 0.10, hi: 0.15, label: "10-15%" },
  { lo: 0.15, hi: 0.20, label: "15-20%" },
  { lo: 0.20, hi: 0.30, label: "20-30%" },
  { lo: 0.30, hi: 0.50, label: "30-50%" },
  { lo: 0.50, hi: 1.00, label: "50%+"  },
];

console.log("1. Calibration curve  (predicted probability → realized hit rate):");
console.log("   bucket     bets   mean predP   hit%     drift       Brier");
console.log("   " + "-".repeat(60));

let totalBrier = 0, totalLog = 0, nWithProb = 0;
for (const b of PROB_BUCKETS) {
  const inBucket = rows.filter(t => {
    const p = recoverProb(t.capturedEV, t.capturedOdds);
    return p != null && p >= b.lo && p < b.hi;
  });
  if (inBucket.length === 0) continue;
  let sumP = 0, wins = 0, brierSum = 0, logSum = 0;
  for (const t of inBucket) {
    const p = recoverProb(t.capturedEV, t.capturedOdds)!;
    const won = t.status === "won" ? 1 : 0;
    sumP += p;
    if (won) wins++;
    brierSum += (p - won) ** 2;
    logSum  += -(won * Math.log(Math.max(1e-6, p)) + (1 - won) * Math.log(Math.max(1e-6, 1 - p)));
  }
  totalBrier += brierSum; totalLog += logSum; nWithProb += inBucket.length;
  const meanP   = sumP / inBucket.length;
  const hitRate = wins / inBucket.length;
  const drift   = hitRate - meanP;
  const brier   = brierSum / inBucket.length;
  console.log("   " + [
    b.label.padEnd(10),
    String(inBucket.length).padStart(4),
    `${(meanP   * 100).toFixed(1)}%`.padStart(12),
    `${(hitRate * 100).toFixed(1)}%`.padStart(7),
    `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(1)}pp`.padStart(11),
    brier.toFixed(3).padStart(10),
  ].join(" "));
}
console.log("   " + "-".repeat(60));

// Model Brier vs a pure-market-implied (p = 1/odds) baseline. If the model's
// Brier is worse than market's, the model is adding noise, not signal — and
// MODEL_WEIGHT should go to 0.
let marketBrier = 0, marketN = 0;
for (const t of rows) {
  if (!t.capturedOdds || t.capturedOdds <= 1) continue;
  const p = 1 / t.capturedOdds;
  const won = t.status === "won" ? 1 : 0;
  marketBrier += (p - won) ** 2;
  marketN++;
}
console.log(`   Model     Brier: ${(totalBrier  / nWithProb).toFixed(4)}    log loss: ${(totalLog / nWithProb).toFixed(4)}`);
console.log(`   Market-1/odds Brier: ${(marketBrier / marketN).toFixed(4)}    (comparison — model must beat this)`);

// ---------- 2. ROI by captured-odds bucket ----------
// The favorite-longshot bias diagnostic. Uniform under-performance across all
// odds buckets = calibration problem. Under-performance concentrated in the
// high-odds buckets = classic favorite-longshot: bombs paying less than their
// true probability implies. That would justify bucket-specific MODEL_WEIGHT
// (lower w for longshots) rather than the current global 0.30.
const ODDS_BUCKETS = [
  { lo: 1,  hi: 3,   label: "<3-1"  },
  { lo: 3,  hi: 6,   label: "3-6"   },
  { lo: 6,  hi: 10,  label: "6-10"  },
  { lo: 10, hi: 20,  label: "10-20" },
  { lo: 20, hi: 40,  label: "20-40" },
  { lo: 40, hi: 999, label: "40+"   },
];

console.log("\n2. ROI by captured-odds bucket  (favorite-longshot bias detector):");
console.log("   odds       bets  won   hit%    avgEV%     ROI        P/L");
console.log("   " + "-".repeat(62));
for (const b of ODDS_BUCKETS) {
  const inBucket = rows.filter(t => t.capturedOdds >= b.lo && t.capturedOdds < b.hi);
  if (inBucket.length === 0) continue;
  const wins   = inBucket.filter(t => t.status === "won").length;
  const staked = inBucket.reduce((s, t) => s + t.stake, 0);
  const pl     = inBucket.reduce((s, t) => s + (t.realizedPL ?? 0), 0);
  const avgEV  = inBucket.reduce((s, t) => s + t.capturedEV, 0) / inBucket.length;
  const roi    = staked > 0 ? pl / staked : 0;
  console.log("   " + [
    b.label.padEnd(9),
    String(inBucket.length).padStart(5),
    String(wins).padStart(4),
    `${(wins / inBucket.length * 100).toFixed(1)}%`.padStart(7),
    `+${avgEV.toFixed(1)}%`.padStart(9),
    `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`.padStart(9),
    `$${pl.toFixed(2)}`.padStart(10),
  ].join(" "));
}

// ---------- 3. ROI by captured-EV bucket ----------
// If the EV signal is real, ROI should climb monotonically with predicted EV.
// If ROI is flat or worse-than-random across EV buckets, the strategy's EV
// number is not decision-useful and threshold tuning won't help.
const EV_BUCKETS = [
  { lo: 0,   hi: 5,   label: "0-5"    },
  { lo: 5,   hi: 10,  label: "5-10"   },
  { lo: 10,  hi: 20,  label: "10-20"  },
  { lo: 20,  hi: 40,  label: "20-40"  },
  { lo: 40,  hi: 999, label: "40+"    },
];

console.log("\n3. ROI by captured-EV bucket  (does higher predicted EV → higher ROI?):");
console.log("   EV%        bets  won   hit%    avgOdds    ROI        P/L");
console.log("   " + "-".repeat(62));
for (const b of EV_BUCKETS) {
  const inBucket = rows.filter(t => t.capturedEV >= b.lo && t.capturedEV < b.hi);
  if (inBucket.length === 0) continue;
  const wins    = inBucket.filter(t => t.status === "won").length;
  const staked  = inBucket.reduce((s, t) => s + t.stake, 0);
  const pl      = inBucket.reduce((s, t) => s + (t.realizedPL ?? 0), 0);
  const avgOdds = inBucket.reduce((s, t) => s + t.capturedOdds, 0) / inBucket.length;
  const roi     = staked > 0 ? pl / staked : 0;
  console.log("   " + [
    b.label.padEnd(9),
    String(inBucket.length).padStart(5),
    String(wins).padStart(4),
    `${(wins / inBucket.length * 100).toFixed(1)}%`.padStart(7),
    avgOdds.toFixed(1).padStart(9),
    `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`.padStart(9),
    `$${pl.toFixed(2)}`.padStart(10),
  ].join(" "));
}

// ---------- 4. Reading guide ----------
// Sample sizes below ~30/bucket are too noisy to tune on — treat this
// section as a checklist for what to watch for as the sample grows, not
// as immediately actionable numbers.
console.log("\n4. How to read this  (with n = " + rows.length + "):");
console.log("   • Calibration column 'drift' should be ~0 in every bucket. A row");
console.log("     with predP=25% but hit%=10% means the model is systematically");
console.log("     overrating that segment — shrink further OR filter it out.");
console.log("   • Odds bucket ROI: if 20+/1 rows are strongly negative while <6-1");
console.log("     rows are flat or positive, that's the favorite-longshot signal");
console.log("     and argues for odds-bucketed MODEL_WEIGHT.");
console.log("   • EV bucket ROI: needs to be monotonically increasing to justify");
console.log("     raising evThreshold. Flat/inverted → EV number is noise.");
console.log("   • Buckets with <30 bets carry huge CI; wait for more data before");
console.log("     acting on them.\n");

db.close();
