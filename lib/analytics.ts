// Analytics queries — read straight from SQLite so the dashboard reflects
// every settled ticket, not just what's in the rolling in-memory cache.
import { db } from "./db";

export interface StrategyAnalytics {
  id: string;
  bets: number;                      // tickets that actually became bets (open + settled)
  settled: number;
  open: number;
  staged: number;                    // strategy matched but not yet promoted by optimal-timer
  aborted: number;                   // killed because live EV collapsed before fire
  won: number;
  lost: number;
  staked: number;
  realizedPL: number;
  capturedEVTotal: number;
  hitRate: number | null;
  roi: number | null;
  avgClv: number | null;
  // Average model EV re-priced at the closing tote — the truthful signal
  // check. If avgClosingEV stays positive while ROI is deeply negative,
  // the model's true-P is miscalibrated (not just bad luck / bad CLV).
  avgClosingEV: number | null;
  avgCapturedEV: number | null;
  // Statistical confidence
  roiStdErr: number | null;          // Standard error of mean ROI per bet
  roiCI95Low: number | null;         // 95% CI lower bound
  roiCI95High: number | null;        // 95% CI upper bound
  significant: boolean;              // CI doesn't cross 0 AND bets ≥ 30
  confidenceLabel: "too-small" | "noise" | "edge" | "loss";
  // Calibration audit
  predictedPL: number;
  calibrationRatio: number | null;   // actual / predicted
  // Payout provenance. Exotic wins settled before real-tote grading landed
  // (payoutSource NULL) or on races with no payoff feed were paid at the
  // strategy's own book-time estimate — that P/L is directional fiction.
  // WIN/PLACE/SHOW always settle at real tote prices and are never counted.
  estPayoutWins: number;             // exotic wins paid at estimated payouts
  estPayoutPL: number;               // realizedPL carried by those wins
  // Out-of-sample split for strategies whose calibration was fitted on past
  // bets (tvg-baseline family). In-sample ROI is curve-fit by construction;
  // only bets placed AFTER the weight was frozen test the model honestly.
  oos: {
    since: number;                   // freeze timestamp (ms epoch)
    bets: number;
    settled: number;
    won: number;
    staked: number;
    realizedPL: number;
    hitRate: number | null;
    roi: number | null;
    roiCI95Low: number | null;
    roiCI95High: number | null;
  } | null;
}

// Calibration freeze timestamps. Bets placed at/after these are out-of-sample
// for the fitted weight; bets before are the fit sample (or pre-fit data).
//   tvg-baseline:        0.30 re-blend fitted on the 159-bet audit through
//                        2026-06-29 (predates the repo — see tvg-baseline.ts).
//   harness/QH variants: 0.15 weight set in commit d9b4228 (2026-07-11) off
//                        the 68-bet harness audit.
const CALIBRATION_FREEZE: Record<string, number> = {
  "tvg-baseline": Date.parse("2026-06-30T00:00:00Z"),
  "tvg-baseline-harness": Date.parse("2026-07-12T00:44:13Z"),
  "tvg-baseline-qh": Date.parse("2026-07-12T00:44:13Z"),
};

export interface DailyPL {
  day: string;        // YYYY-MM-DD
  strategyId: string;
  bets: number;
  pl: number;
  cumPL: number;
}

export interface DailyTotal {
  day: string;        // YYYY-MM-DD (local date derived from placedAt)
  bets: number;       // tickets that became bets
  settled: number;
  won: number;
  staked: number;
  realizedPL: number;
  hitRate: number | null;
  roi: number | null;
}

export interface TrackPerformance {
  trackCode: string;
  trackName: string;
  bets: number;
  won: number;
  hitRate: number | null;
  roi: number | null;
  realizedPL: number;
}

// Bets = anything that actually became a real ticket (open or settled).
// Staged tickets are pending decisions; aborted ones were killed before fire
// because live EV went negative — neither counts as a placed bet. Aborted
// counts are surfaced separately so users can see how often the optimal-timer
// is saving them from -EV fires.
const Q_STRATEGY = db.prepare(`
  SELECT
    strategyId,
    SUM(CASE WHEN status IN ('open','won','lost') THEN 1 ELSE 0 END)  AS bets,
    SUM(CASE WHEN status IN ('won','lost') THEN 1 ELSE 0 END)         AS settled,
    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)                  AS open,
    SUM(CASE WHEN status = 'staged' THEN 1 ELSE 0 END)                AS staged,
    SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END)               AS aborted,
    SUM(CASE WHEN status = 'won'  THEN 1 ELSE 0 END)                  AS won,
    SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END)                  AS lost,
    SUM(CASE WHEN status IN ('open','won','lost') THEN stake ELSE 0 END)  AS staked,
    SUM(CASE WHEN status IN ('won','lost') THEN realizedPL ELSE 0 END)    AS realizedPL,
    SUM(CASE WHEN status IN ('open','won','lost') THEN stake * capturedEV / 100.0 ELSE 0 END) AS predictedPL,
    SUM(CASE WHEN status IN ('open','won','lost') THEN capturedEV * stake / 100.0 ELSE 0 END) AS capturedEVTotal,
    AVG(CASE
      -- CLV is only meaningful for single-race WIN bets. Our closing snapshot
      -- captures WIN odds, so comparing WIN captured-vs-close gives a real
      -- read on whether we beat the public. For PLACE/SHOW we'd need place/show
      -- closing prices (not snapshotted), and for Pick-N we'd need per-leg WIN
      -- closes joined back to the start-race id — neither is implemented yet,
      -- so CLV is null for non-WIN bets rather than computed against the wrong
      -- pool (which previously produced misleading negative numbers on Dr Z).
      WHEN status IN ('won','lost') AND type = 'WIN'
        AND closingOdds > 0 AND stake > 0
      THEN (capturedOdds - closingOdds) / closingOdds
    END)                                                              AS avgClv,
    AVG(CASE
      WHEN status IN ('won','lost') AND stake > 0 THEN realizedPL / stake
    END)                                                              AS avgRoi,
    AVG(CASE
      WHEN status IN ('won','lost') AND closingEV IS NOT NULL
      THEN closingEV
    END)                                                              AS avgClosingEV,
    AVG(CASE
      WHEN status IN ('won','lost') AND capturedEV IS NOT NULL
      THEN capturedEV
    END)                                                              AS avgCapturedEV,
    SUM(CASE
      WHEN status IN ('won','lost') AND stake > 0
      THEN (realizedPL / stake) * (realizedPL / stake)
      ELSE 0
    END)                                                              AS sumRoiSq,
    SUM(CASE
      WHEN status = 'won'
        AND type IN ('EXACTA','TRIFECTA','DD','P3','P4','P5','P6','J6')
        AND (payoutSource IS NULL OR payoutSource = 'estimated')
      THEN 1 ELSE 0
    END)                                                              AS estPayoutWins,
    SUM(CASE
      WHEN status = 'won'
        AND type IN ('EXACTA','TRIFECTA','DD','P3','P4','P5','P6','J6')
        AND (payoutSource IS NULL OR payoutSource = 'estimated')
      THEN realizedPL ELSE 0
    END)                                                              AS estPayoutPL
  FROM tickets
  WHERE strategyId IS NOT NULL
  GROUP BY strategyId
`);

// Out-of-sample aggregates for one calibrated strategy: bets placed at/after
// the freeze timestamp only.
const Q_OOS = db.prepare(`
  SELECT
    SUM(CASE WHEN status IN ('open','won','lost') THEN 1 ELSE 0 END)     AS bets,
    SUM(CASE WHEN status IN ('won','lost') THEN 1 ELSE 0 END)            AS settled,
    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END)                      AS won,
    SUM(CASE WHEN status IN ('open','won','lost') THEN stake ELSE 0 END) AS staked,
    SUM(CASE WHEN status IN ('won','lost') THEN realizedPL ELSE 0 END)   AS realizedPL,
    AVG(CASE WHEN status IN ('won','lost') AND stake > 0 THEN realizedPL / stake END) AS avgRoi,
    SUM(CASE
      WHEN status IN ('won','lost') AND stake > 0
      THEN (realizedPL / stake) * (realizedPL / stake)
      ELSE 0
    END)                                                                 AS sumRoiSq
  FROM tickets
  WHERE strategyId = ? AND placedAt >= ?
`);

function oosFor(strategyId: string): StrategyAnalytics["oos"] {
  const since = CALIBRATION_FREEZE[strategyId];
  if (!since) return null;
  const r = Q_OOS.get(strategyId, since) as any;
  const settled = r?.settled || 0;
  const avgRoi = r?.avgRoi ?? null;
  const variance = settled > 1 && avgRoi != null
    ? Math.max(0, (r.sumRoiSq || 0) / settled - avgRoi * avgRoi)
    : null;
  const stdErr = variance != null && settled > 0 ? Math.sqrt(variance / settled) : null;
  const ci95 = stdErr != null ? 1.96 * stdErr : null;
  return {
    since,
    bets: r?.bets || 0,
    settled,
    won: r?.won || 0,
    staked: r?.staked || 0,
    realizedPL: r?.realizedPL || 0,
    hitRate: settled > 0 ? (r.won || 0) / settled : null,
    roi: r?.staked > 0 ? (r.realizedPL || 0) / r.staked : null,
    roiCI95Low: avgRoi != null && ci95 != null ? avgRoi - ci95 : null,
    roiCI95High: avgRoi != null && ci95 != null ? avgRoi + ci95 : null,
  };
}

export function strategyAnalytics(): StrategyAnalytics[] {
  const rows = Q_STRATEGY.all() as any[];
  return rows.map(r => {
    const settled = r.settled || 0;
    const avgRoi = r.avgRoi;
    const sumSq = r.sumRoiSq || 0;
    const variance = settled > 1 && avgRoi != null
      ? Math.max(0, sumSq / settled - avgRoi * avgRoi)
      : null;
    const stdErr = variance != null && settled > 0 ? Math.sqrt(variance / settled) : null;
    const ci95 = stdErr != null ? 1.96 * stdErr : null;
    const roiLow  = avgRoi != null && ci95 != null ? avgRoi - ci95 : null;
    const roiHigh = avgRoi != null && ci95 != null ? avgRoi + ci95 : null;
    const sig = settled >= 30 && roiLow != null && roiHigh != null && (roiLow > 0 || roiHigh < 0);
    let conf: StrategyAnalytics["confidenceLabel"];
    if (settled < 30) conf = "too-small";
    else if (sig && (avgRoi ?? 0) > 0) conf = "edge";
    else if (sig && (avgRoi ?? 0) < 0) conf = "loss";
    else conf = "noise";
    return {
      id: r.strategyId,
      bets: r.bets || 0,
      settled,
      open: r.open || 0,
      staged: r.staged || 0,
      aborted: r.aborted || 0,
      won: r.won || 0,
      lost: r.lost || 0,
      staked: r.staked || 0,
      realizedPL: r.realizedPL || 0,
      capturedEVTotal: r.capturedEVTotal || 0,
      hitRate: settled > 0 ? (r.won || 0) / settled : null,
      roi: r.staked > 0 ? (r.realizedPL || 0) / r.staked : null,
      avgClv: r.avgClv,
      avgClosingEV: r.avgClosingEV,
      avgCapturedEV: r.avgCapturedEV,
      roiStdErr: stdErr,
      roiCI95Low: roiLow,
      roiCI95High: roiHigh,
      significant: sig,
      confidenceLabel: conf,
      predictedPL: r.predictedPL || 0,
      calibrationRatio: r.predictedPL ? (r.realizedPL || 0) / r.predictedPL : null,
      estPayoutWins: r.estPayoutWins || 0,
      estPayoutPL: r.estPayoutPL || 0,
      oos: oosFor(r.strategyId),
    };
  });
}

// Day bucketing for the two daily queries happens in the VIEWER's timezone:
// the client passes its UTC offset (?tz=, minutes, as Date.getTimezoneOffset
// returns) and we shift epochs by it before taking the UTC date. This keeps
// the calendar consistent with the dashboard's "today since midnight" strip,
// which uses the same offset. Fallback is the server's current offset —
// equivalent to the old 'localtime' bucketing except across historical DST
// transitions, where days near midnight can shift by an hour. Accepted: the
// same fixed-offset convention is used everywhere, so no view disagrees.
const Q_DAILY = db.prepare(`
  SELECT
    date(placedAt / 1000 - ? * 60, 'unixepoch') AS day,
    strategyId,
    COUNT(*)                                                            AS bets,
    SUM(CASE WHEN status IN ('won','lost') THEN realizedPL ELSE 0 END)  AS pl
  FROM tickets
  WHERE strategyId IS NOT NULL
    AND status IN ('open','won','lost')
    AND placedAt >= ?
  GROUP BY day, strategyId
  ORDER BY day ASC, strategyId
`);

export function dailyPL(lookbackDays: number, tzOffsetMin?: number | null): DailyPL[] {
  const tz = tzOffsetMin ?? new Date().getTimezoneOffset();
  const since = Date.now() - lookbackDays * 86_400_000;
  const rows = Q_DAILY.all(tz, since) as any[];
  // Compute cumulative P/L per strategy
  const cum: Record<string, number> = {};
  const out: DailyPL[] = [];
  for (const r of rows) {
    cum[r.strategyId] = (cum[r.strategyId] ?? 0) + (r.pl || 0);
    out.push({
      day: r.day,
      strategyId: r.strategyId,
      bets: r.bets || 0,
      pl: r.pl || 0,
      cumPL: cum[r.strategyId],
    });
  }
  return out;
}

const Q_DAILY_TOTALS = db.prepare(`
  SELECT
    date(placedAt / 1000 - ? * 60, 'unixepoch') AS day,
    SUM(CASE WHEN status IN ('open','won','lost') THEN 1 ELSE 0 END) AS bets,
    SUM(CASE WHEN status IN ('won','lost') THEN 1 ELSE 0 END)        AS settled,
    SUM(CASE WHEN status = 'won'  THEN 1 ELSE 0 END)                 AS won,
    SUM(CASE WHEN status IN ('open','won','lost') THEN stake ELSE 0 END) AS staked,
    SUM(CASE WHEN status IN ('won','lost') THEN realizedPL ELSE 0 END)   AS realizedPL
  FROM tickets
  WHERE strategyId IS NOT NULL
    AND status IN ('open','won','lost')
    AND placedAt >= ?
  GROUP BY day
  ORDER BY day ASC
`);

export function dailyTotals(lookbackDays: number, tzOffsetMin?: number | null): DailyTotal[] {
  const tz = tzOffsetMin ?? new Date().getTimezoneOffset();
  const since = Date.now() - lookbackDays * 86_400_000;
  const rows = Q_DAILY_TOTALS.all(tz, since) as any[];
  return rows.map(r => ({
    day: r.day,
    bets: r.bets || 0,
    settled: r.settled || 0,
    won: r.won || 0,
    staked: r.staked || 0,
    realizedPL: r.realizedPL || 0,
    hitRate: r.settled > 0 ? (r.won || 0) / r.settled : null,
    roi: r.staked > 0 ? (r.realizedPL || 0) / r.staked : null,
  }));
}

const Q_TRACK = db.prepare(`
  SELECT
    trackCode,
    trackName,
    COUNT(*)                                              AS bets,
    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END)       AS won,
    SUM(stake)                                            AS staked,
    SUM(CASE WHEN status IN ('won','lost') THEN realizedPL ELSE 0 END) AS realizedPL
  FROM tickets
  WHERE strategyId IS NOT NULL AND status IN ('won','lost')
  GROUP BY trackCode, trackName
  ORDER BY bets DESC
  LIMIT 25
`);

export function trackPerformance(): TrackPerformance[] {
  const rows = Q_TRACK.all() as any[];
  return rows.map(r => ({
    trackCode: r.trackCode ?? "",
    trackName: r.trackName ?? "",
    bets: r.bets || 0,
    won: r.won || 0,
    hitRate: r.bets > 0 ? r.won / r.bets : null,
    roi: r.staked > 0 ? r.realizedPL / r.staked : null,
    realizedPL: r.realizedPL || 0,
  }));
}

export interface ConsensusTier {
  tier: number;                    // how many strategies agreed
  bets: number;                    // total tickets at this tier
  settled: number;
  won: number;
  staked: number;
  realizedPL: number;
  hitRate: number | null;
  roi: number | null;
  avgClv: number | null;
}

export interface PairConsensus {
  strategies: string[];            // e.g. ["tvg-baseline","track-bias"]
  bets: number;
  settled: number;
  won: number;
  staked: number;
  realizedPL: number;
  hitRate: number | null;
  roi: number | null;
  avgClv: number | null;
}

// Tickets bucketed by how many distinct strategies agreed on (race, selection).
// Tier 1 = solo, tier 2 = two strategies independently picked the same horse, etc.
// Agreement is detected across all lifecycle states (staged + aborted + open
// + settled) so the count reflects how often strategies converge. But the
// downstream bet/stake/PL aggregations only count tickets that actually became
// bets (open/won/lost).
const Q_CONSENSUS_TIERS = db.prepare(`
  WITH agreement AS (
    SELECT raceId, selections, COUNT(DISTINCT strategyId) AS sCount
    FROM tickets
    WHERE strategyId IS NOT NULL
    GROUP BY raceId, selections
  )
  SELECT
    a.sCount                                              AS tier,
    COUNT(*)                                              AS bets,
    SUM(CASE WHEN t.status IN ('won','lost') THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN t.status = 'won' THEN 1 ELSE 0 END)     AS won,
    SUM(t.stake)                                          AS staked,
    SUM(CASE WHEN t.status IN ('won','lost') THEN t.realizedPL ELSE 0 END) AS realizedPL,
    AVG(CASE
      WHEN t.status IN ('won','lost') AND t.type = 'WIN' AND t.closingOdds > 0
      THEN (t.capturedOdds - t.closingOdds) / t.closingOdds
    END)                                                  AS avgClv
  FROM tickets t
  JOIN agreement a ON t.raceId = a.raceId AND t.selections = a.selections
  WHERE t.strategyId IS NOT NULL AND t.status IN ('open','won','lost')
  GROUP BY a.sCount
  ORDER BY a.sCount ASC
`);

export function consensusTiers(): ConsensusTier[] {
  const rows = Q_CONSENSUS_TIERS.all() as any[];
  return rows.map(r => ({
    tier: r.tier,
    bets: r.bets || 0,
    settled: r.settled || 0,
    won: r.won || 0,
    staked: r.staked || 0,
    realizedPL: r.realizedPL || 0,
    hitRate: r.settled > 0 ? (r.won || 0) / r.settled : null,
    roi: r.staked > 0 ? (r.realizedPL || 0) / r.staked : null,
    avgClv: r.avgClv,
  }));
}

// For each (race, selection) where ≥2 strategies fired, list the unique
// strategy-set and aggregate the tickets that landed on those exact agreements.
// Lets you ask "how does [tvg-baseline ∩ track-bias] perform specifically?"
export function pairConsensus(): PairConsensus[] {
  const rows = db.prepare(`
    WITH agreement AS (
      SELECT raceId, selections,
        (SELECT GROUP_CONCAT(s, ',')
           FROM (SELECT DISTINCT strategyId AS s
                   FROM tickets t2
                   WHERE t2.raceId = t1.raceId AND t2.selections = t1.selections
                     AND t2.strategyId IS NOT NULL
                   ORDER BY strategyId)) AS strats,
        COUNT(DISTINCT strategyId) AS sCount
      FROM tickets t1
      WHERE strategyId IS NOT NULL
      GROUP BY raceId, selections
      HAVING sCount >= 2
    )
    SELECT
      a.strats                                              AS strats,
      COUNT(*)                                              AS bets,
      SUM(CASE WHEN t.status IN ('won','lost') THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN t.status = 'won' THEN 1 ELSE 0 END)     AS won,
      SUM(t.stake)                                          AS staked,
      SUM(CASE WHEN t.status IN ('won','lost') THEN t.realizedPL ELSE 0 END) AS realizedPL,
      AVG(CASE
        WHEN t.status IN ('won','lost') AND t.type = 'WIN' AND t.closingOdds > 0
        THEN (t.capturedOdds - t.closingOdds) / t.closingOdds
      END)                                                  AS avgClv
    FROM tickets t
    JOIN agreement a ON t.raceId = a.raceId AND t.selections = a.selections
    WHERE t.strategyId IS NOT NULL AND t.status IN ('open','won','lost')
    GROUP BY a.strats
    ORDER BY bets DESC
  `).all() as any[];
  return rows.map(r => ({
    strategies: (r.strats ?? "").split(",").map((s: string) => s.trim()).filter(Boolean).sort(),
    bets: r.bets || 0,
    settled: r.settled || 0,
    won: r.won || 0,
    staked: r.staked || 0,
    realizedPL: r.realizedPL || 0,
    hitRate: r.settled > 0 ? (r.won || 0) / r.settled : null,
    roi: r.staked > 0 ? (r.realizedPL || 0) / r.staked : null,
    avgClv: r.avgClv,
  }));
}

export function totals() {
  const r = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('open','won','lost') THEN 1 ELSE 0 END) AS bets,
      SUM(CASE WHEN status IN ('won','lost') THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END)       AS won,
      SUM(CASE WHEN status IN ('open','won','lost') THEN stake ELSE 0 END) AS staked,
      SUM(CASE WHEN status IN ('won','lost') THEN realizedPL ELSE 0 END) AS realizedPL,
      MIN(CASE WHEN status IN ('open','won','lost') THEN placedAt END) AS firstBet,
      MAX(CASE WHEN status IN ('open','won','lost') THEN placedAt END) AS lastBet
    FROM tickets
    WHERE strategyId IS NOT NULL
  `).get() as any;
  return {
    bets: r.bets || 0,
    settled: r.settled || 0,
    won: r.won || 0,
    staked: r.staked || 0,
    realizedPL: r.realizedPL || 0,
    hitRate: r.settled > 0 ? (r.won || 0) / r.settled : null,
    roi: r.staked > 0 ? (r.realizedPL || 0) / r.staked : null,
    firstBetAt: r.firstBet ?? null,
    lastBetAt: r.lastBet ?? null,
  };
}
