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
  // Strategy-attribution view: performance including races this strategy was
  // shadowed on (another strategy fired the real bet first on the same pick).
  // Credits shadowPL at the strategy's would-be stake. NEVER summed into the
  // bankroll — this is for evaluating the strategy in isolation, not tracking
  // money spent. `shadowWon`/`shadowPL` isolate the slice the bankroll-true
  // realizedPL is missing, so the UI can explain the delta.
  attribution: {
    bets: number;
    settled: number;
    won: number;
    realizedPL: number;               // real-when-fired + shadow-when-shadowed
    roi: number | null;               // over attribution settled stake
    hitRate: number | null;
    roiCI95Low: number | null;
    roiCI95High: number | null;
    shadowWon: number;                // wins that were shadowed (invisible in bankroll view)
    shadowSettled: number;
    shadowPL: number;                 // hypothetical P&L from the shadowed slice
  };
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
//
// shadow = 0 on EVERY aggregate here: shadow tickets (stake $0, fired when
// another strategy already covered the same selection) are attribution
// records, not bets. The dashboard roll-up already excluded them; these
// queries didn't, so Results/Analytics counts ran higher than the dashboard
// for the same day. One definition everywhere: a bet is a non-shadow ticket.
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
    END)                                                              AS estPayoutPL,
    SUM(CASE WHEN status IN ('won','lost') THEN stake ELSE 0 END)     AS settledStaked
  FROM tickets
  WHERE strategyId IS NOT NULL AND shadow = 0
  GROUP BY strategyId
`);

// Strategy-ATTRIBUTION aggregates — the "how does this strategy actually
// perform" view, distinct from the bankroll-true numbers in Q_STRATEGY.
//
// Q_STRATEGY filters shadow = 0 because a shadow ticket didn't spend real
// money: when tvg-steam fired first on a pick, tvg-baseline's identical pick
// was booked as a $0 shadow so the bankroll isn't double-debited. Correct for
// bankroll — but it means every race a strategy got beaten to is silently
// dropped from ITS win/loss record, understating (or hiding) its true edge.
//
// This query includes shadow rows and credits them at the stake the strategy
// WOULD have bet: shadowStake / shadowPL instead of stake / realizedPL. The
// two views must never be summed into the bankroll — this is per-strategy
// evaluation only. Shadow rows settled before 2026-07-17 have neither field
// (COALESCE → 0), so they contribute nothing and are honestly omitted rather
// than counted as $0 wins.
const ATTR_STAKE = `(CASE WHEN shadow = 1 THEN COALESCE(shadowStake, 0) ELSE stake END)`;
const ATTR_PL = `(CASE WHEN shadow = 1 THEN COALESCE(shadowPL, 0) ELSE realizedPL END)`;
const Q_STRATEGY_ATTR = db.prepare(`
  SELECT
    strategyId,
    SUM(CASE WHEN status IN ('open','won','lost') THEN 1 ELSE 0 END)  AS attribBets,
    SUM(CASE WHEN status IN ('won','lost')        THEN 1 ELSE 0 END)  AS attribSettled,
    SUM(CASE WHEN status = 'won'                  THEN 1 ELSE 0 END)  AS attribWon,
    SUM(CASE WHEN status IN ('won','lost') THEN ${ATTR_PL}    ELSE 0 END) AS attribPL,
    SUM(CASE WHEN status IN ('won','lost') THEN ${ATTR_STAKE} ELSE 0 END) AS attribSettledStaked,
    AVG(CASE
      WHEN status IN ('won','lost') AND ${ATTR_STAKE} > 0
      THEN ${ATTR_PL} / ${ATTR_STAKE}
    END)                                                             AS attribAvgRoi,
    SUM(CASE
      WHEN status IN ('won','lost') AND ${ATTR_STAKE} > 0
      THEN (${ATTR_PL} / ${ATTR_STAKE}) * (${ATTR_PL} / ${ATTR_STAKE})
      ELSE 0
    END)                                                             AS attribSumRoiSq,
    -- Shadow-only slice: how much of the above is picks this strategy was
    -- beaten to (i.e. invisible in the bankroll-true view). Lets the UI show
    -- "+N shadowed wins" so the delta between the two views is explained.
    SUM(CASE WHEN shadow = 1 AND status IN ('won','lost') THEN 1 ELSE 0 END)              AS shadowSettled,
    SUM(CASE WHEN shadow = 1 AND status = 'won' THEN 1 ELSE 0 END)                        AS shadowWon,
    SUM(CASE WHEN shadow = 1 AND status IN ('won','lost') THEN COALESCE(shadowPL,0) ELSE 0 END) AS shadowPLTotal
  FROM tickets
  -- Exclude pre-2026-07-17 shadows (shadowPL never recorded): they're genuinely
  -- unmeasurable, so drop them rather than count them as $0-stake phantom bets —
  -- which would both inflate settled count and desync the CI's N from the sums.
  WHERE strategyId IS NOT NULL AND (shadow = 0 OR shadowPL IS NOT NULL)
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
    END)                                                                 AS sumRoiSq,
    SUM(CASE WHEN status IN ('won','lost') THEN stake ELSE 0 END)        AS settledStaked
  FROM tickets
  WHERE strategyId = ? AND placedAt >= ? AND shadow = 0
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
    // ROI over SETTLED stake — open bets have no realized outcome yet, so
    // including their stake in the denominator understates ROI and disagrees
    // with the dashboard, which always used settled stake.
    roi: r?.settledStaked > 0 ? (r.realizedPL || 0) / r.settledStaked : null,
    roiCI95Low: avgRoi != null && ci95 != null ? avgRoi - ci95 : null,
    roiCI95High: avgRoi != null && ci95 != null ? avgRoi + ci95 : null,
  };
}

function attributionFor(row: any): StrategyAnalytics["attribution"] {
  const settled = row?.attribSettled || 0;
  const avgRoi = row?.attribAvgRoi ?? null;
  const variance = settled > 1 && avgRoi != null
    ? Math.max(0, (row.attribSumRoiSq || 0) / settled - avgRoi * avgRoi)
    : null;
  const stdErr = variance != null && settled > 0 ? Math.sqrt(variance / settled) : null;
  const ci95 = stdErr != null ? 1.96 * stdErr : null;
  const staked = row?.attribSettledStaked || 0;
  return {
    bets: row?.attribBets || 0,
    settled,
    won: row?.attribWon || 0,
    realizedPL: row?.attribPL || 0,
    roi: staked > 0 ? (row?.attribPL || 0) / staked : null,
    hitRate: settled > 0 ? (row?.attribWon || 0) / settled : null,
    roiCI95Low: avgRoi != null && ci95 != null ? avgRoi - ci95 : null,
    roiCI95High: avgRoi != null && ci95 != null ? avgRoi + ci95 : null,
    shadowWon: row?.shadowWon || 0,
    shadowSettled: row?.shadowSettled || 0,
    shadowPL: row?.shadowPLTotal || 0,
  };
}

export function strategyAnalytics(): StrategyAnalytics[] {
  const rows = Q_STRATEGY.all() as any[];
  const attrByStrategy = new Map<string, any>(
    (Q_STRATEGY_ATTR.all() as any[]).map(a => [a.strategyId, a]),
  );
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
      roi: r.settledStaked > 0 ? (r.realizedPL || 0) / r.settledStaked : null,
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
      attribution: attributionFor(attrByStrategy.get(r.strategyId)),
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
    AND shadow = 0
    AND status IN ('open','won','lost')
    AND placedAt >= ?
  GROUP BY day, strategyId
  ORDER BY day ASC, strategyId
`);

// Epoch ms of the viewer-local midnight (lookbackDays - 1) days ago. A
// "14 day" window is exactly the 14 calendar days the stats calendar renders
// — never a rolling `now - 14*24h` instant, which drags in a truncated
// partial 15th day that the grid has no cell for (header said +$1089 while
// the visible cells summed to a loss).
function sinceLocalMidnight(lookbackDays: number, tzOffsetMin: number): number {
  const shiftedNow = Date.now() - tzOffsetMin * 60_000;
  const startOfTodayShifted = Math.floor(shiftedNow / 86_400_000) * 86_400_000;
  return startOfTodayShifted - (lookbackDays - 1) * 86_400_000 + tzOffsetMin * 60_000;
}

export function dailyPL(lookbackDays: number, tzOffsetMin?: number | null): DailyPL[] {
  const tz = tzOffsetMin ?? new Date().getTimezoneOffset();
  const since = sinceLocalMidnight(lookbackDays, tz);
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
    SUM(CASE WHEN status IN ('won','lost') THEN stake ELSE 0 END)        AS settledStaked,
    SUM(CASE WHEN status IN ('won','lost') THEN realizedPL ELSE 0 END)   AS realizedPL
  FROM tickets
  WHERE strategyId IS NOT NULL
    AND shadow = 0
    AND status IN ('open','won','lost')
    AND placedAt >= ?
  GROUP BY day
  ORDER BY day ASC
`);

export function dailyTotals(lookbackDays: number, tzOffsetMin?: number | null): DailyTotal[] {
  const tz = tzOffsetMin ?? new Date().getTimezoneOffset();
  const since = sinceLocalMidnight(lookbackDays, tz);
  const rows = Q_DAILY_TOTALS.all(tz, since) as any[];
  return rows.map(r => ({
    day: r.day,
    bets: r.bets || 0,
    settled: r.settled || 0,
    won: r.won || 0,
    staked: r.staked || 0,
    realizedPL: r.realizedPL || 0,
    hitRate: r.settled > 0 ? (r.won || 0) / r.settled : null,
    roi: r.settledStaked > 0 ? (r.realizedPL || 0) / r.settledStaked : null,
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
  WHERE strategyId IS NOT NULL AND shadow = 0 AND status IN ('won','lost')
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
    SUM(CASE WHEN t.status IN ('won','lost') THEN t.stake ELSE 0 END) AS settledStaked,
    SUM(CASE WHEN t.status IN ('won','lost') THEN t.realizedPL ELSE 0 END) AS realizedPL,
    AVG(CASE
      WHEN t.status IN ('won','lost') AND t.type = 'WIN' AND t.closingOdds > 0
      THEN (t.capturedOdds - t.closingOdds) / t.closingOdds
    END)                                                  AS avgClv
  FROM tickets t
  JOIN agreement a ON t.raceId = a.raceId AND t.selections = a.selections
  -- Agreement detection (the CTE) keeps shadow rows: a shadow ticket is
  -- exactly the evidence that a second strategy agreed. The money/count
  -- aggregation below must not double-count them, though.
  WHERE t.strategyId IS NOT NULL AND t.shadow = 0 AND t.status IN ('open','won','lost')
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
    roi: r.settledStaked > 0 ? (r.realizedPL || 0) / r.settledStaked : null,
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
      SUM(CASE WHEN t.status IN ('won','lost') THEN t.stake ELSE 0 END) AS settledStaked,
      SUM(CASE WHEN t.status IN ('won','lost') THEN t.realizedPL ELSE 0 END) AS realizedPL,
      AVG(CASE
        WHEN t.status IN ('won','lost') AND t.type = 'WIN' AND t.closingOdds > 0
        THEN (t.capturedOdds - t.closingOdds) / t.closingOdds
      END)                                                  AS avgClv
    FROM tickets t
    JOIN agreement a ON t.raceId = a.raceId AND t.selections = a.selections
    WHERE t.strategyId IS NOT NULL AND t.shadow = 0 AND t.status IN ('open','won','lost')
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
    roi: r.settledStaked > 0 ? (r.realizedPL || 0) / r.settledStaked : null,
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
      SUM(CASE WHEN status IN ('won','lost') THEN stake ELSE 0 END) AS settledStaked,
      MIN(CASE WHEN status IN ('open','won','lost') THEN placedAt END) AS firstBet,
      MAX(CASE WHEN status IN ('open','won','lost') THEN placedAt END) AS lastBet
    FROM tickets
    WHERE strategyId IS NOT NULL AND shadow = 0
  `).get() as any;
  return {
    bets: r.bets || 0,
    settled: r.settled || 0,
    won: r.won || 0,
    staked: r.staked || 0,
    realizedPL: r.realizedPL || 0,
    hitRate: r.settled > 0 ? (r.won || 0) / r.settled : null,
    roi: r.settledStaked > 0 ? (r.realizedPL || 0) / r.settledStaked : null,
    firstBetAt: r.firstBet ?? null,
    lastBetAt: r.lastBet ?? null,
  };
}
