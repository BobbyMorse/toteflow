// Session-level race-results tracker. Populated by the grader each time it
// observes a final race on the TVG results feed. Strategies that depend on
// same-day outcomes (track-bias, etc.) query this store.
//
// Scope: in-memory, current process only. Reset on server restart. Entries
// auto-expire after RESULT_TTL_MS to keep state small and to avoid carrying
// yesterday's results into today's bias detection — a card change can flip
// a track's bias overnight (new rail position, weather, etc.).

export interface RaceResult {
  trackCode: string;
  raceNumber: number;
  surface: string;          // "Dirt" | "Turf" | ...
  distance: string;
  winnerProgram: string;
  finishOrder: string[];    // top finishers, program numbers
  fieldSize: number;        // runners that started — required for post-tier math
  capturedAt: number;
}

const RESULT_TTL_MS = 18 * 60 * 60 * 1000;   // 18h — drop overnight history

declare global {
  // eslint-disable-next-line no-var
  var __toteflowRaceResults: Map<string, RaceResult> | undefined;
}

const store: Map<string, RaceResult> =
  globalThis.__toteflowRaceResults ?? (globalThis.__toteflowRaceResults = new Map());

function keyOf(trackCode: string, raceNumber: number): string {
  return `${trackCode}-${raceNumber}`;
}

function purgeExpired(now: number) {
  for (const [k, v] of store) {
    if (now - v.capturedAt > RESULT_TTL_MS) store.delete(k);
  }
}

export const RaceResults = {
  record(result: Omit<RaceResult, "capturedAt">) {
    const now = Date.now();
    purgeExpired(now);
    const key = keyOf(result.trackCode, result.raceNumber);
    if (store.has(key)) return; // already recorded, don't overwrite
    store.set(key, { ...result, capturedAt: now });
  },

  // All results for a track. Optionally filter by surface (Dirt/Turf/...).
  forTrack(trackCode: string, surface?: string): RaceResult[] {
    purgeExpired(Date.now());
    const out: RaceResult[] = [];
    for (const v of store.values()) {
      if (v.trackCode !== trackCode) continue;
      if (surface && v.surface !== surface) continue;
      out.push(v);
    }
    return out.sort((a, b) => a.raceNumber - b.raceNumber);
  },

  size() { return store.size; },
};
