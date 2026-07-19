// Field-wide closing-line backtest against the local DB.
//   npx tsx scripts/closing-line-backtest.ts
//   npx tsx scripts/closing-line-backtest.ts --train 0.7 --min-field 5
// For the full production set, hit /api/debug/closing-line-backtest on Fly.
import Database from "better-sqlite3";
import path from "path";
import { loadRacesFromDb, analyze, formatReport } from "../lib/closing-line-backtest";

const args = process.argv.slice(2);
const num = (flag: string, def: number) =>
  args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : def;
const trainFrac = num("--train", 0.7);
const minField = num("--min-field", 5);

const db = new Database(path.join(process.cwd(), "data", "toteflow.db"), { readonly: true });
const races = loadRacesFromDb(db, minField);
if (races.length === 0) {
  console.log("No settled field-wide snapshots found.");
  process.exit(0);
}
const report = analyze(races, { trainFrac, minField, bootstrap: 2000 });
console.log("\n" + formatReport(report) + "\n");
db.close();
