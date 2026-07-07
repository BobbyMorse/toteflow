import type { RacingProvider, Race, Runner } from "../types";
import { fractionalOdds } from "../format";
import { classifyTrack } from "../track-types";
// theracingapi.com — free tier for UK/Irish racing. Set RACING_API_USER + RACING_API_PASS.
const USER = process.env.RACING_API_USER;
const PASS = process.env.RACING_API_PASS;

async function fetchCards(): Promise<Race[]> {
  if (!USER || !PASS) return [];
  try {
    const auth = Buffer.from(`${USER}:${PASS}`).toString("base64");
    const res = await fetch("https://api.theracingapi.com/v1/racecards/standard", {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const out: Race[] = [];
    for (const card of json.racecards ?? []) {
      const runners: Runner[] = (card.runners ?? []).map((r: any, i: number) => {
        const odds = Number(r.odds?.[0]?.decimal ?? 5);
        return {
          program: String(i + 1),
          saddleNumber: i + 1,
          name: r.horse ?? `Runner ${i + 1}`,
          jockey: r.jockey,
          trainer: r.trainer,
          currentOdds: odds,
          fractionalOdds: fractionalOdds(odds),
          oddsHistory: [{ t: Date.now(), odds }],
          winPoolShare: 1 / Math.max(1.1, odds),
          steamScore: 0,
          evPercent: 0,
        };
      });
      const trackCode = (card.course ?? "RA").slice(0, 4).toUpperCase();
      out.push({
        id: `RA-${card.course}-${card.off_time}`,
        track: card.course,
        trackCode,
        raceNumber: out.length + 1,
        postTime: new Date(card.off_dt ?? card.off_time).getTime(),
        surface: "Turf",
        distance: card.distance ?? "1M",
        runners,
        winPoolTotal: 50000,
        exactaPoolTotal: 25000,
        trifectaPoolTotal: 15000,
        takeout: 0.16,
        phase: "scheduled",
        source: "racingapi",
        lastTick: Date.now(),
        trackType: classifyTrack(trackCode, card.course),
      });
    }
    return out;
  } catch { return []; }
}

export const racingApiAdapter: RacingProvider = {
  id: "racingapi",
  label: "The Racing API (UK/IRE)",
  status: USER && PASS ? "live" : "needs-key",
  notes: "Set RACING_API_USER and RACING_API_PASS env vars to enable.",
  async listRaces() { return fetchCards(); },
  async getRace(id) { const all = await fetchCards(); return all.find(r => r.id === id) ?? null; },
};
