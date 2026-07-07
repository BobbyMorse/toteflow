// Quick SQL analytics for accumulated ticket data.
// Usage: npx tsx scripts/analyze.ts
//        npx tsx scripts/analyze.ts --strategy tvg-baseline
//        npx tsx scripts/analyze.ts --days 7
//
// Use ad-hoc SQL: open data/toteflow.db with the sqlite3 CLI:
//   sqlite3 data/toteflow.db
//   .headers on
//   .mode column
//   .tables
//   SELECT strategyId, COUNT(*), SUM(realizedPL) FROM tickets WHERE status != 'open' GROUP BY strategyId;

import Database from "better-sqlite3";
import path from "path";

const args = process.argv.slice(2);
const strategy = args.includes("--strategy") ? args[args.indexOf("--strategy") + 1] : null;
const days = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : null;
const since = days ? Date.now() - days * 86_400_000 : 0;

const db = new Database(path.join(process.cwd(), "data", "toteflow.db"), { readonly: true });

function fmt(v: unknown, dp = 2): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toFixed(dp);
  return String(v);
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

console.log("\n=== ToteFlow Analytics ===\n");
console.log(`Filters: strategy=${strategy ?? "ALL"} · since=${since ? new Date(since).toISOString() : "ALL TIME"}\n`);

// 1. Overall + per-strategy leaderboard
const baseFilter = `WHERE status IN ('won','lost') AND placedAt >= ?${strategy ? " AND strategyId = ?" : ""}`;
const baseParams: unknown[] = [since];
if (strategy) baseParams.push(strategy);

const overall = db.prepare(`
  SELECT
    strategyId,
    COUNT(*)                                            AS bets,
    SUM(CASE WHEN status = 'won'  THEN 1 ELSE 0 END)    AS won,
    SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END)    AS lost,
    SUM(stake)                                          AS staked,
    SUM(realizedPL)                                     AS pl,
    AVG(capturedEV)                                     AS avgEv,
    AVG(CASE WHEN closingOdds > 0 THEN (capturedOdds - closingOdds) / closingOdds END) AS avgClv,
    AVG(CASE WHEN status = 'won' THEN 1.0 ELSE 0.0 END) AS hitRate
  FROM tickets
  ${baseFilter}
  GROUP BY strategyId
  ORDER BY (CASE WHEN SUM(stake)>0 THEN SUM(realizedPL)/SUM(stake) ELSE 0 END) DESC
`).all(...baseParams) as any[];

console.log("Per-strategy leaderboard (sorted by ROI desc):\n");
console.log("strategy            bets won lost  hit%   avgCLV   avgEV    ROI   real P/L");
console.log("-".repeat(85));
for (const r of overall) {
  const roi = r.staked > 0 ? r.pl / r.staked : null;
  console.log([
    (r.strategyId ?? "(none)").padEnd(18),
    String(r.bets).padStart(5),
    String(r.won).padStart(4),
    String(r.lost).padStart(4),
    `${(r.hitRate * 100).toFixed(0)}%`.padStart(6),
    pct(r.avgClv).padStart(8),
    `${(r.avgEv).toFixed(1)}%`.padStart(7),
    pct(roi).padStart(7),
    `$${r.pl.toFixed(2)}`.padStart(10),
  ].join(" "));
}

// 2. Per-track performance
console.log("\n\nPer-track performance (top 15 by bet count):\n");
const perTrack = db.prepare(`
  SELECT
    trackCode,
    COUNT(*)                                            AS bets,
    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END)     AS won,
    SUM(realizedPL)                                     AS pl,
    SUM(stake)                                          AS staked
  FROM tickets
  ${baseFilter}
  GROUP BY trackCode
  ORDER BY bets DESC
  LIMIT 15
`).all(...baseParams) as any[];

console.log("track   bets won   hit%      ROI     P/L");
console.log("-".repeat(50));
for (const r of perTrack) {
  const roi = r.staked > 0 ? r.pl / r.staked : null;
  const hit = r.bets ? r.won / r.bets : null;
  console.log([
    (r.trackCode ?? "?").padEnd(6),
    String(r.bets).padStart(5),
    String(r.won).padStart(4),
    pct(hit).padStart(7),
    pct(roi).padStart(8),
    `$${r.pl.toFixed(2)}`.padStart(9),
  ].join(" "));
}

// 3. Daily P/L per strategy (last 14 days)
console.log("\n\nDaily P/L (last 14 days):\n");
const daily = db.prepare(`
  SELECT
    date(placedAt / 1000, 'unixepoch')                  AS day,
    strategyId,
    COUNT(*) AS bets,
    SUM(realizedPL) AS pl
  FROM tickets
  WHERE status IN ('won','lost')
    AND placedAt >= ?
    ${strategy ? "AND strategyId = ?" : ""}
  GROUP BY day, strategyId
  ORDER BY day DESC, strategyId
`).all(Date.now() - 14 * 86_400_000, ...(strategy ? [strategy] : [])) as any[];

console.log("day        strategy           bets    P/L");
console.log("-".repeat(50));
for (const r of daily.slice(0, 40)) {
  console.log([
    r.day,
    (r.strategyId ?? "?").padEnd(18),
    String(r.bets).padStart(5),
    `$${fmt(r.pl)}`.padStart(9),
  ].join("  "));
}

// 4. Slippage / EV gap diagnostic
console.log("\n\nCalibration audit (captured EV vs realized $):\n");
const gap = db.prepare(`
  SELECT
    strategyId,
    SUM(stake * capturedEV / 100.0) AS predictedPL,
    SUM(realizedPL)                 AS actualPL,
    COUNT(*)                        AS bets
  FROM tickets
  ${baseFilter}
  GROUP BY strategyId
`).all(...baseParams) as any[];

console.log("strategy           bets   predicted    actual   actual/pred");
console.log("-".repeat(65));
for (const r of gap) {
  const ratio = r.predictedPL ? r.actualPL / r.predictedPL : null;
  console.log([
    (r.strategyId ?? "?").padEnd(18),
    String(r.bets).padStart(5),
    `$${fmt(r.predictedPL)}`.padStart(11),
    `$${fmt(r.actualPL)}`.padStart(10),
    ratio == null ? "—" : `${ratio.toFixed(2)}×`.padStart(11),
  ].join("  "));
}

console.log(`\n=== Total tickets in DB: ${(db.prepare("SELECT COUNT(*) AS c FROM tickets").get() as any).c} ===\n`);
db.close();
