import type { RacingProvider, Race, Runner } from "../types";
import { fractionalOdds } from "../format";
import { takeoutForTrack } from "../track-takeout";
import { classifyTrack } from "../track-types";

const ENDPOINT = "https://service.tvg.com/graph/v2/query";

// Query TVG's open GraphQL endpoint. No auth required.
// Returns all currently-scheduled races (US + AU + INT'L) that they list.
// biPools fetches per-runner pool composition (Dr. Z + bridge-jumper need it).
// We pull WN/PL/SH/EX/TR/DB shapes; we filter to W/P/S in toRace because
// combo bets (EX/TR/DB) emit O(n²) rows we don't currently consume.
const QUERY = `{
  races {
    id number trackCode trackName mtp postTime distance purse
    surface { name }
    status { code name }
    bettingInterests {
      biNumber saddleColor favorite
      morningLineOdds { numerator denominator }
      currentOdds { numerator denominator }
      runners { horseName jockey trainer scratched winProbability }
      biPools { wagerType { code } poolRunnersData { amount biTarget } }
    }
    pools { amount wagerType { code name } }
    wagerTypes { type { code } minWagerAmount minTicketAmount }
  }
}`;

interface TvgOdd { numerator: number | null; denominator: number | null }
interface TvgRunner {
  horseName: string; jockey: string; trainer: string;
  scratched: boolean; winProbability: number | null;
}
interface TvgBiPoolRunnerData { amount: number | null; biTarget: number | null }
interface TvgBiPool {
  wagerType: { code: string } | null;
  poolRunnersData: TvgBiPoolRunnerData[] | null;
}
interface TvgBI {
  biNumber: number; saddleColor: string; favorite: boolean;
  morningLineOdds: TvgOdd | null;
  currentOdds: TvgOdd | null;
  runners: TvgRunner[];
  biPools: TvgBiPool[] | null;
}
interface TvgPool { amount: number; wagerType: { code: string; name: string } | null }
interface TvgWagerType {
  type: { code: string } | null;
  minWagerAmount: number | null;
  minTicketAmount: number | null;
}
interface TvgRace {
  id: string; number: string;
  trackCode: string; trackName: string;
  mtp: number; postTime: string;
  distance: string | null; purse: number | null;
  surface: { name: string } | null;
  status: { code: string; name: string } | null;
  bettingInterests: TvgBI[];
  pools: TvgPool[];
  wagerTypes: TvgWagerType[] | null;
}

function oddToDecimal(o: TvgOdd | null | undefined): number {
  if (!o || o.numerator == null) return 99;
  const num = o.numerator;
  const den = o.denominator ?? 1;
  if (num <= 0 || den <= 0) return 99;
  // TVG returns fractional. 6/null = 6/1 = decimal 7.
  return num / den + 1;
}

// Per-track takeout lives in track-takeout.ts. Major US tracks are
// individually tabled (e.g. Santa Anita 15.43%, Tampa 18.5%); unknown
// tracks fall back to a country average.

function inferCountry(trackName: string, code: string): string {
  if (trackName?.startsWith("AU - ")) return "AU";
  if (trackName?.startsWith("INT - ") || trackName?.startsWith("UK")) return "GB";
  return "US";
}

function poolByCode(pools: TvgPool[] | null | undefined, code: string): number {
  return (pools ?? []).find(p => p?.wagerType?.code === code)?.amount ?? 0;
}

// Codes already exposed as first-class fields on Race; everything else from
// TVG's pools array is a multi-leg/exotic wager (P3/P4/P5/P6/J6/SU/...).
const SINGLE_LEG_CODES = new Set(["WN", "PL", "SH", "EX", "TR"]);

function extractMultiLegPools(pools: TvgPool[] | null | undefined) {
  if (!pools?.length) return undefined;
  const out: NonNullable<Race["multiLegPools"]> = [];
  for (const p of pools) {
    const code = p?.wagerType?.code;
    if (!code || SINGLE_LEG_CODES.has(code)) continue;
    if (typeof p.amount !== "number" || p.amount <= 0) continue;
    out.push({ code, name: p.wagerType?.name ?? code, amount: p.amount });
  }
  return out.length ? out : undefined;
}

// Single-runner W/P/S amount from biPools. For win/place/show, TVG emits
// exactly one entry per pool per BI with biTarget=null and amount = dollars
// on that horse in that pool. Combo bets (EX/TR/DB) have biTarget set and
// are ignored here.
function biPoolAmount(biPools: TvgBiPool[] | null | undefined, code: string): number | undefined {
  if (!biPools) return undefined;
  for (const bp of biPools) {
    if (bp?.wagerType?.code !== code) continue;
    const entry = (bp.poolRunnersData ?? []).find(d => d?.biTarget == null);
    if (entry && entry.amount != null) return entry.amount;
  }
  return undefined;
}

function toRace(tr: TvgRace): Race {
  const country = inferCountry(tr.trackName, tr.trackCode);
  const poolTakeout = takeoutForTrack(tr.trackCode, country);
  const takeout = poolTakeout.win;
  const now = Date.now();
  const postTime = tr.postTime ? new Date(tr.postTime).getTime() : (now + tr.mtp * 60_000);

  // First pass: collect raw model + market for each entry so we can audit the
  // model before computing EV. TVG's winProbability is excellent on liquid US
  // thoroughbred markets and noisy/uniform on smaller international fields.
  type Raw = {
    bi: TvgBI; horse: TvgRunner | undefined;
    decimal: number; mlDecimal: number; scratched: boolean;
    rawP: number;
  };
  const raws: Raw[] = tr.bettingInterests.map(bi => {
    const horse = bi.runners?.[0];
    return {
      bi, horse,
      decimal: oddToDecimal(bi.currentOdds),
      mlDecimal: oddToDecimal(bi.morningLineOdds),
      scratched: horse?.scratched ?? false,
      rawP: horse?.winProbability ?? 0,
    };
  });

  // Model quality audit. The model is trustworthy only if:
  //   1. Probabilities sum to ~1.0 across live runners (TVG's model is normalized)
  //   2. There's real variance — not just every horse pegged at 1/N
  // If untrustworthy, we fall back to market-implied probability so EV
  // collapses to roughly −takeout for everyone (which is the honest answer).
  const liveRaws = raws.filter(r => !r.scratched && r.decimal < 60 && r.rawP > 0);
  let modelQuality: "high" | "medium" | "low" = "low";
  let modelQualityReason = "no model output";
  let pSum = 0, pMax = 0, pMin = 1;
  if (liveRaws.length >= 3) {
    for (const r of liveRaws) {
      pSum += r.rawP;
      if (r.rawP > pMax) pMax = r.rawP;
      if (r.rawP < pMin) pMin = r.rawP;
    }
    const sumOk = pSum > 0.7 && pSum < 1.3;
    const spread = pMax / Math.max(0.005, pMin);
    if (!sumOk) {
      modelQuality = "low";
      modelQualityReason = `model probs sum to ${pSum.toFixed(2)}, expected ~1.0`;
    } else if (spread < 2.5) {
      modelQuality = "low";
      modelQualityReason = `flat distribution (max/min ${spread.toFixed(1)}x)`;
    } else if (spread < 4) {
      modelQuality = "medium";
      modelQualityReason = `moderate distribution spread (${spread.toFixed(1)}x)`;
    } else {
      modelQuality = "high";
      modelQualityReason = `healthy spread (${spread.toFixed(1)}x)`;
    }
  }

  const runners: Runner[] = raws.map(raw => {
    const { bi, horse, decimal, mlDecimal, scratched, rawP } = raw;
    const marketImpliedP = 1 / Math.max(1.2, decimal);
    // Blend model with market based on confidence — bad models collapse to
    // pure market, good models get most of the weight (but never 100%).
    const modelWeight =
      modelQuality === "high"   ? 0.65 :
      modelQuality === "medium" ? 0.35 :
                                  0;
    // Renormalize model so it actually sums to 1 across live runners
    const normalizedP = pSum > 0 ? rawP / pSum : marketImpliedP;
    let trueP =
      scratched || rawP <= 0 || decimal >= 60
        ? marketImpliedP
        : modelWeight * normalizedP + (1 - modelWeight) * marketImpliedP;
    trueP = Math.max(0.005, Math.min(0.95, trueP));

    const rawEv = scratched ? 0
      : (trueP * (decimal - 1) * (1 - takeout) - (1 - trueP)) * 100;
    // Lower-bound at -100% (can't lose more than the stake) but otherwise pass
    // the raw model EV through. The previous +25% sanity cap was hiding signal
    // — many bets pinned to identical +25.0% values regardless of odds drift —
    // so we let the model's actual estimate flow through. Strategies stay
    // honest by gating on evPercent vs their own configured thresholds.
    const ev = Math.max(-100, rawEv);
    const winShare = 1 / Math.max(1.2, decimal);
    return {
      program: String(bi.biNumber),
      saddleNumber: bi.biNumber,
      name: horse?.horseName ?? "Unknown",
      jockey: horse?.jockey ?? "",
      trainer: horse?.trainer ?? "",
      morningLine: mlDecimal,
      currentOdds: decimal,
      fractionalOdds: fractionalOdds(decimal),
      prevOdds: decimal,
      oddsHistory: [{ t: now, odds: decimal }],
      winPoolShare: winShare,
      truePWin: trueP,
      steamScore: 0,
      evPercent: ev,
      evPercentRaw: rawEv,
      projectedFinalOdds: decimal,
      scratched,
      silkColor: bi.saddleColor ?? undefined,
      winPoolAmount: biPoolAmount(bi.biPools, "WN"),
      placePoolAmount: biPoolAmount(bi.biPools, "PL"),
      showPoolAmount: biPoolAmount(bi.biPools, "SH"),
    };
  });

  const ms = postTime - now;
  const phase: Race["phase"] =
    ms > 15 * 60_000 ? "scheduled" :
    ms > 5 * 60_000  ? "discovery" :
    ms > 60_000      ? "action"    :
    ms > 0           ? "chaos"     : "off";

  // Live per-wager minimums straight from the tote feed — authoritative
  // truth for what the track actually accepts. Replaces the static guess in
  // lib/wager-minimums.ts (which is now only a fallback when the feed is
  // missing this race's wagerTypes).
  const wagerMinimums: Record<string, { minWager: number; minTicket: number }> = {};
  for (const wt of tr.wagerTypes ?? []) {
    const code = wt.type?.code;
    if (!code || wt.minWagerAmount == null || wt.minTicketAmount == null) continue;
    wagerMinimums[code] = { minWager: wt.minWagerAmount, minTicket: wt.minTicketAmount };
  }

  return {
    id: `TVG-${tr.id}`,
    track: tr.trackName,
    trackCode: tr.trackCode,
    raceNumber: Number(tr.number) || 0,
    postTime,
    surface: ((tr.surface?.name as Race["surface"]) ?? "Dirt"),
    distance: tr.distance ?? "",
    purse: tr.purse ?? undefined,
    conditions: tr.status?.name ?? "",
    runners,
    winPoolTotal: poolByCode(tr.pools, "WN"),
    placePoolTotal: poolByCode(tr.pools, "PL") || undefined,
    showPoolTotal: poolByCode(tr.pools, "SH") || undefined,
    exactaPoolTotal: poolByCode(tr.pools, "EX"),
    trifectaPoolTotal: poolByCode(tr.pools, "TR"),
    multiLegPools: extractMultiLegPools(tr.pools),
    takeout,
    poolTakeout,
    phase,
    source: "tvg",
    lastTick: now,
    modelQuality,
    modelQualityReason,
    wagerMinimums: Object.keys(wagerMinimums).length ? wagerMinimums : undefined,
    trackType: classifyTrack(tr.trackCode, tr.trackName),
  };
}

// Cache + per-race odds history (so steam scores can be computed across polls)
const oddsHistory = new Map<string, { t: number; odds: number }[]>();
let cache: Race[] = [];
let lastFetch = 0;
const TTL_MS = 10_000;

function applyHistory(race: Race, now: number) {
  for (const rn of race.runners) {
    const key = `${race.id}:${rn.program}`;
    const hist = oddsHistory.get(key) ?? [];
    // Only append if odds actually changed
    const lastOdds = hist[hist.length - 1]?.odds;
    if (lastOdds === undefined || Math.abs(lastOdds - rn.currentOdds) > 0.001) {
      hist.push({ t: now, odds: rn.currentOdds });
    }
    while (hist.length > 60) hist.shift();
    oddsHistory.set(key, hist);
    rn.oddsHistory = hist.slice();
    rn.prevOdds = hist.length >= 2 ? hist[hist.length - 2].odds : rn.currentOdds;
    // Steam: velocity over the last 90s
    const cutoff = now - 90_000;
    const recent = hist.filter(h => h.t > cutoff);
    if (recent.length >= 2) {
      const first = recent[0].odds, last = recent[recent.length - 1].odds;
      const drop = (first - last) / first;
      rn.steamScore = Math.max(0, Math.min(100, Math.round(drop * 100 * 8)));
    } else {
      rn.steamScore = 0;
    }
    // Projected final
    if (recent.length >= 3) {
      const slope = (recent[recent.length - 1].odds - recent[0].odds) /
                    Math.max(1, recent[recent.length - 1].t - recent[0].t);
      const toPost = Math.max(0, race.postTime - now);
      rn.projectedFinalOdds = Math.max(1.2, rn.currentOdds + slope * toPost * 0.6);
    } else {
      rn.projectedFinalOdds = rn.currentOdds;
    }
  }
}

async function fetchTVG(): Promise<Race[]> {
  const now = Date.now();
  if (now - lastFetch < TTL_MS && cache.length) {
    // Refresh derived fields against new clock even when cached
    cache.forEach(r => applyHistory(r, now));
    return cache;
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ToteFlow/0.1 (+local)",
        "Accept": "application/json",
      },
      body: JSON.stringify({ query: QUERY }),
      cache: "no-store",
    });
    if (!res.ok) { console.warn("TVG fetch HTTP", res.status); return cache; }
    const json: any = await res.json();
    if (json.errors) {
      console.warn("TVG errors", json.errors.slice(0, 2));
      return cache;
    }
    const races: TvgRace[] = json.data?.races ?? [];
    // Use absolute postTime — TVG's `mtp` is a snapshot that never updates.
    // Keep races within the next 90 min, plus ones that just went off (last 3 min).
    const inWindow = races
      .filter(r => r.bettingInterests && r.bettingInterests.length > 0)
      .filter(r => {
        if (!r.postTime) return false;
        const ms = new Date(r.postTime).getTime() - now;
        return ms > -3 * 60_000 && ms < 90 * 60_000;
      })
      // Exclude statuses we don't care about (results, official, dark, cancelled)
      .filter(r => {
        const code = r.status?.code ?? "";
        return !["RO", "MO", "C", "D"].includes(code);
      });

    // POSTDRAG instrumentation — verify whether TVG's mtp/status.code can
    // detect actual off vs scheduled post. Logs races in the ±3 min drag
    // window every fetch (10s cadence). Once we confirm the fields update
    // during drag, we can use them to push the fire window into real T-15s.
    for (const r of inWindow) {
      const schedMs = new Date(r.postTime).getTime() - now;
      if (schedMs > 3 * 60_000 || schedMs < -3 * 60_000) continue;
      const trackType = classifyTrack(r.trackName, r.trackCode);
      console.log(
        `[POSTDRAG] ${r.trackCode} R${r.number} type=${trackType} ` +
        `schedT${schedMs >= 0 ? "-" : "+"}${Math.abs(Math.round(schedMs / 1000))}s ` +
        `mtp=${r.mtp} status=${r.status?.code ?? "?"}`,
      );
    }

    const mapped = inWindow.map(toRace);
    mapped.forEach(r => applyHistory(r, now));
    cache = mapped;
    lastFetch = now;
    return cache;
  } catch (e) {
    console.warn("TVG fetch error", e);
    return cache;
  }
}

// Direct-by-id fetch that bypasses the time-window filter, so the race-room
// page can still load a race that has just finished (or is far in the future).
async function fetchOneTVG(id: string): Promise<Race | null> {
  // First try cache (within window)
  const cached = await fetchTVG();
  const hit = cached.find(r => r.id === id);
  if (hit) return hit;
  if (!id.startsWith("TVG-")) return null;
  const tvgId = id.slice(4);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ToteFlow/0.1", "Accept": "application/json" },
      body: JSON.stringify({ query: QUERY }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const found = (json.data?.races ?? []).find((r: TvgRace) => r.id === tvgId);
    if (!found || !found.bettingInterests?.length) return null;
    const race = toRace(found);
    applyHistory(race, Date.now());
    return race;
  } catch { return null; }
}

export const tvgAdapter: RacingProvider = {
  id: "tvg",
  label: "TVG (live US/INT'L)",
  status: "live",
  notes: "Open GraphQL — live current odds + TVG model winProbability for real EV.",
  async listRaces() { return fetchTVG(); },
  async getRace(id) { return fetchOneTVG(id); },
};
