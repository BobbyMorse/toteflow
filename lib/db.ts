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
  return withDbLock(dir, () => {
    const db = new Database(file);
    db.pragma("busy_timeout = 30000");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    return db;
  });
}

// Serialize DB init across processes with a filesystem mutex. Necessary
// because `next build` spawns parallel worker processes to collect page data,
// and each worker imports this module. Two problems this prevents:
//   1. `PRAGMA journal_mode = WAL` needs an exclusive lock. When the file is
//      first being created, parallel workers race and one gets SQLITE_BUSY
//      even with busy_timeout (the exclusive-lock wait isn't always covered).
//   2. `ALTER TABLE ADD COLUMN`: without a lock, workers snapshot PRAGMA
//      table_info before any ADD commits, then all try to add the same column
//      and the losers throw "duplicate column name" (a logical error that
//      busy_timeout doesn't help with).
function withDbLock<T>(dir: string, fn: () => T): T {
  const lockPath = path.join(dir, ".schema.lock");
  const deadline = Date.now() + 60_000;
  let acquired = false;
  while (!acquired) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.closeSync(fd);
      acquired = true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      // Break stale locks (crashed worker) after 30s of untouched age.
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 30_000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch { /* raced with unlink — retry */ }
      if (Date.now() > deadline) throw new Error("timed out waiting for db lock");
      // Synchronous ~50ms sleep. Atomics.wait needs SharedArrayBuffer, which is
      // fine on Node but noisy — this is simpler and only runs during startup.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* another process already cleaned up */ }
  }
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

    -- Per-runner closing snapshots for EVERY race we watch (not just races we
    -- bet). One row per (raceId, day, program), upserted while the race
    -- approaches post so the final write is the closing state; the grader
    -- stamps finishPosition + real payoffs when the result arrives. This is
    -- the model-calibration training set: (model P, market odds, outcome)
    -- across the whole field, free of bet-selection bias. TVG reuses raceIds
    -- (e.g. TVG-CBY-1) across days, hence the day key.
    CREATE TABLE IF NOT EXISTS runner_snapshots (
      raceId          TEXT NOT NULL,
      day             TEXT NOT NULL,
      program         TEXT NOT NULL,
      trackCode       TEXT,
      raceNumber      INTEGER,
      trackType       TEXT,
      surface         TEXT,
      distance        TEXT,
      modelQuality    TEXT,
      fieldSize       INTEGER,
      postTime        INTEGER,
      capturedAt      INTEGER NOT NULL,
      odds            REAL,
      morningLine     REAL,
      truePWin        REAL,
      evPercent       REAL,
      winPoolAmount   REAL,
      placePoolAmount REAL,
      showPoolAmount  REAL,
      winPoolTotal    REAL,
      placePoolTotal  REAL,
      showPoolTotal   REAL,
      takeout         REAL,
      scratched       INTEGER NOT NULL DEFAULT 0,
      finishPosition  INTEGER,
      winPayoff       REAL,
      placePayoff     REAL,
      showPayoff      REAL,
      settledAt       INTEGER,
      PRIMARY KEY (raceId, day, program)
    );
    CREATE INDEX IF NOT EXISTS idx_snaps_captured ON runner_snapshots(capturedAt);
    CREATE INDEX IF NOT EXISTS idx_snaps_settled  ON runner_snapshots(settledAt);
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
  if (!ticketCols.has("capturedTrueP")) {
    db.exec("ALTER TABLE tickets ADD COLUMN capturedTrueP REAL");
  }
  if (!ticketCols.has("payoutSource")) {
    db.exec("ALTER TABLE tickets ADD COLUMN payoutSource TEXT");
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
// db connection cached from before the schema change. Guarded by the same
// cross-process lock so concurrent HMR reloads don't race either.
withDbLock(ensureDataDir(), () => applySchema(db));

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
