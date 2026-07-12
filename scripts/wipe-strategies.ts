// One-shot: delete all tickets for the given strategyIds.
//
// Usage:
//   npx tsx scripts/wipe-strategies.ts             # dry-run against the hardcoded list
//   npx tsx scripts/wipe-strategies.ts --confirm   # actually delete
//
// On Fly:
//   fly ssh console -C "cd /app && npx tsx scripts/wipe-strategies.ts --confirm"
//
// Deletes tickets in every lifecycle state (staged/open/settled/aborted).
// Also removes the strategy_configs rows for strategies that no longer exist
// in the registry so the config page stays clean.

import { db } from "../lib/db";

// Strategies whose paper record is now invalid:
//   - overlay-vs-ml family: strategy deleted (structurally -EV; see commit d9b4228)
//   - tvg-baseline-harness/qh: model weight halved (0.30 → 0.15), so prior
//     paper P&L was fit against the old formula and is no longer meaningful
const TARGETS = [
  "overlay-vs-ml",
  "overlay-vs-ml-harness",
  "overlay-vs-ml-qh",
  "tvg-baseline-harness",
  "tvg-baseline-qh",
];

// Strategies whose config row can also be dropped (strategy no longer exists
// in the registry at all). Kept separate from the ticket wipe because we
// don't want to blow away tvg-baseline-harness/qh config — those strategies
// still exist, they just got recalibrated.
const CONFIG_TO_REMOVE = [
  "overlay-vs-ml",
  "overlay-vs-ml-harness",
  "overlay-vs-ml-qh",
];

const confirm = process.argv.includes("--confirm");

const placeholders = TARGETS.map(() => "?").join(",");
const counts = db.prepare(
  `SELECT strategyId, status, COUNT(*) AS n
   FROM tickets
   WHERE strategyId IN (${placeholders})
   GROUP BY strategyId, status
   ORDER BY strategyId, status`,
).all(...TARGETS) as Array<{ strategyId: string; status: string; n: number }>;

const configHits = db.prepare(
  `SELECT id FROM strategy_configs WHERE id IN (${CONFIG_TO_REMOVE.map(() => "?").join(",")})`,
).all(...CONFIG_TO_REMOVE) as Array<{ id: string }>;

console.log("Tickets to wipe:");
if (counts.length === 0) {
  console.log("  (none)");
} else {
  let total = 0;
  for (const r of counts) {
    console.log(`  ${r.strategyId.padEnd(24)} ${r.status.padEnd(10)} ${r.n}`);
    total += r.n;
  }
  console.log(`  TOTAL: ${total}`);
}
console.log("");
console.log("Strategy configs to remove:");
if (configHits.length === 0) {
  console.log("  (none)");
} else {
  for (const c of configHits) console.log(`  ${c.id}`);
}

if (!confirm) {
  console.log("\n(dry-run — pass --confirm to execute)");
  process.exit(0);
}

const tx = db.transaction(() => {
  const t = db.prepare(`DELETE FROM tickets WHERE strategyId IN (${placeholders})`).run(...TARGETS);
  const c = db.prepare(
    `DELETE FROM strategy_configs WHERE id IN (${CONFIG_TO_REMOVE.map(() => "?").join(",")})`,
  ).run(...CONFIG_TO_REMOVE);
  return { tickets: t.changes, configs: c.changes };
});

const result = tx();
console.log(`\nDeleted ${result.tickets} tickets and ${result.configs} strategy_configs rows.`);
