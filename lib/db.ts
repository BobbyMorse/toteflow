// SQLite persistence. Single file at data/toteflow.db. Schema is applied
// idempotently on first connect — no migration tool yet because the schema
// is small. When schema needs to evolve, bump SCHEMA_VERSION and add an
// `if (version < N)` block.

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const SCHEMA_VERSION = 1;

function ensureDataDir(): string {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function openDb(): Database.Database {
  const dir = ensureDataDir();
  const file = path.join(dir, "toteflow.db");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id              TEXT PRIMARY KEY,
      raceId          TEXT NOT NULL,
      trackCode       TEXT,
      trackName       TEXT,
      raceNumber      INTEGER,
      horseName       TEXT,
      type            TEXT NOT NULL,
      selections      TEXT NOT NULL,
      stake           REAL NOT NULL,
      potentialPayout REAL NOT NULL,
      capturedEV      REAL NOT NULL,
      capturedOdds    REAL NOT NULL,
      placedAt        INTEGER NOT NULL,
      postTime        INTEGER,
      status          TEXT NOT NULL,
      mode            TEXT NOT NULL,
      strategyId      TEXT,
      reason          TEXT,
      settledAt       INTEGER,
      realizedPL      REAL,
      winners         TEXT,
      closingOdds     REAL,
      closingEV       REAL,
      shadow          INTEGER NOT NULL DEFAULT 0,
      legs            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_strategy ON tickets(strategyId);
    CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_race     ON tickets(raceId);
    CREATE INDEX IF NOT EXISTS idx_tickets_placedAt ON tickets(placedAt);

    CREATE TABLE IF NOT EXISTS strategy_configs (
      id            TEXT PRIMARY KEY,
      enabled       INTEGER NOT NULL,
      evThreshold   REAL NOT NULL,
      stake         REAL NOT NULL,
      fireAtPhase   TEXT NOT NULL
    );
  `);

  // Idempotent column adds for tables that pre-date a column.
  const ticketCols = new Set(
    (db.prepare("PRAGMA table_info(tickets)").all() as Array<{ name: string }>).map(r => r.name),
  );
  if (!ticketCols.has("shadow")) {
    db.exec("ALTER TABLE tickets ADD COLUMN shadow INTEGER NOT NULL DEFAULT 0");
  }
  if (!ticketCols.has("legs")) {
    db.exec("ALTER TABLE tickets ADD COLUMN legs TEXT");
  }
  if (!ticketCols.has("stagedAt")) {
    db.exec("ALTER TABLE tickets ADD COLUMN stagedAt INTEGER");
  }
  if (!ticketCols.has("abortedAt")) {
    db.exec("ALTER TABLE tickets ADD COLUMN abortedAt INTEGER");
  }
  if (!ticketCols.has("abortReason")) {
    db.exec("ALTER TABLE tickets ADD COLUMN abortReason TEXT");
  }
  if (!ticketCols.has("closingEV")) {
    db.exec("ALTER TABLE tickets ADD COLUMN closingEV REAL");
  }
  if (!ticketCols.has("capturedEVRaw")) {
    db.exec("ALTER TABLE tickets ADD COLUMN capturedEVRaw REAL");
  }
  if (!ticketCols.has("closingEVRaw")) {
    db.exec("ALTER TABLE tickets ADD COLUMN closingEVRaw REAL");
  }

  const v = (db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string } | undefined)?.value;
  if (!v) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("schemaVersion", String(SCHEMA_VERSION));
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __toteflowDb: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __toteflowDbSignalsBound: boolean | undefined;
}

export const db = globalThis.__toteflowDb ?? (globalThis.__toteflowDb = openDb());
// applySchema is idempotent; re-run on HMR so newly-added columns land on a
// db connection cached from before the schema change.
applySchema(db);

// Cleanly close on dev server shutdown — prevents WAL file lockup on restart.
// Guarded by a global flag because Next.js HMR re-evaluates this module on
// every change; without the guard, listeners accumulate and trip
// MaxListenersExceededWarning (and eventually crash the dev server).
if (typeof process !== "undefined" && !globalThis.__toteflowDbSignalsBound) {
  globalThis.__toteflowDbSignalsBound = true;
  for (const sig of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
    process.on(sig, () => {
      try { globalThis.__toteflowDb?.close(); } catch {}
    });
  }
}
