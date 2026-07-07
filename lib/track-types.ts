// Classify tracks so strategies can filter by what's realistically bettable
// on major US ADWs (FanDuel Racing, TVG, TwinSpires) and where TVG's
// winProbability model is calibrated (thoroughbred markets).

export type TrackType =
  | "thoroughbred-major"          // BEL, GP, CD, SA, etc.
  | "thoroughbred-minor"          // PRM, EMD, MNR, FRT, etc.
  | "thoroughbred-international"  // GB/IE/FR/AU flat thoroughbred — TVG/FanDuel carries it via commingled pools
  | "harness"                     // NFL, POC, OCD — standardbreds
  | "quarter-horse"               // LA, RD — different breed, short sprints
  | "international"               // jumps tracks + non-thoroughbred international — skip
  | "unknown";

const THOROUGHBRED_MAJOR = new Set([
  "BEL","SAR","AQU","BAQ","GP","CD","SA","KEE","WO","LRL","PIM","MTH","OP","TAM","PRX","DMR","LRC",
]);

const THOROUGHBRED_MINOR = new Set([
  "PRM","EMD","MNR","ABQ","FRT","CNM","CBY","HAW","FE","PHA","TUP","SUN","HOU","RP","WRD","ZIA",
  "ELP","CTR","FMT","ASD","HST","FNO","FL","WYO","BIR",
]);

// "FH" (Freehold, harness) was previously listed in THOROUGHBRED_MINOR too,
// which caused every FH card to pass isThoroughbred() and get bet on. Left in
// HARNESS only — the minor set no longer claims it.
const HARNESS = new Set([
  "NFL","POC","OCD","RUN","STG","TGD","VER","WBS","CHS","PCD","YR","M","MR","SCD","FH","WD","PHL","DOV","SEMA","HOP","HARR","RCR","FRD","PCN","DD","HOO","BMI",
]);

const QUARTER_HORSE = new Set([
  "LA","RD","ALB","LBG","RUI","WMF","ORP","RP","DG","DG2","FNL","BTP",
]);

// International tracks whose meets are predominantly jumps (steeplechase /
// hurdle). TVG's flat-racing winProbability model isn't calibrated for jumps
// — falls, refusals, soft going, weight-carrying dynamics are all different.
// Mixed-card tracks that lean jumps (Aintree, Cheltenham, Punchestown) are
// included here too: safer to miss their flat days than to bet a chase race
// the model can't read. Names are normalized lowercase after the country
// prefix is stripped (e.g. "GB - Cartmel" → "cartmel").
const INTERNATIONAL_JUMPS_NAMES = new Set([
  // UK National Hunt only
  "cartmel","fakenham","fontwell","hexham","huntingdon","kelso","ludlow",
  "market rasen","newton abbot","plumpton","sedgefield","stratford","taunton",
  "towcester","warwick","wetherby","wincanton","worcester","bangor","hereford",
  "uttoxeter","perth",
  // UK predominantly NH (mixed cards — skip to be safe)
  "aintree","cheltenham","ayr","musselburgh",
  // IE NH-only or predominantly
  "thurles","clonmel","fairyhouse","punchestown","navan",
  // FR jumps
  "auteuil",
]);

export function classifyTrack(trackCode: string, trackName?: string): TrackType {
  const code = trackCode.toUpperCase();
  const name = (trackName ?? "").toLowerCase();

  // International prefixes from TVG's naming: "GB - ", "AU - ", "JP - ", etc.
  // We split these into flat (bet-eligible — TVG/FanDuel commingles pools and
  // the model often reads them well) and jumps (skip — different discipline).
  // Names like "NO - Bergen" (Scandinavian harness/trot) don't match a
  // thoroughbred country code, so they fall to plain "international".
  const intlMatch = (trackName ?? "").match(/^([A-Z]{2})\s*-\s*(.+)$/);
  if (intlMatch) {
    const country = intlMatch[1].toUpperCase();
    const trackOnly = intlMatch[2].trim().toLowerCase();
    const FLAT_THOROUGHBRED_COUNTRIES = new Set([
      "GB","IE","FR","AU","JP","HK","SG","UAE","SA","NZ","CA","DE","IT",
    ]);
    if (!FLAT_THOROUGHBRED_COUNTRIES.has(country)) return "international";
    if (INTERNATIONAL_JUMPS_NAMES.has(trackOnly)) return "international";
    return "thoroughbred-international";
  }
  if (/^(L\d|A\d|S\d|AU\d|BT|JP|GG|VM|LY|HX|BS|PJ|KAL|XKD)/.test(code)) return "international";

  if (THOROUGHBRED_MAJOR.has(code)) return "thoroughbred-major";
  if (THOROUGHBRED_MINOR.has(code)) return "thoroughbred-minor";
  if (HARNESS.has(code)) return "harness";
  if (QUARTER_HORSE.has(code)) return "quarter-horse";

  // Heuristic fallbacks based on track name
  if (name.includes("harness") || name.includes("downs") && (
    name.includes("northfield") || name.includes("pocono") || name.includes("ocean") ||
    name.includes("running aces") || name.includes("vernon") || name.includes("tioga")
  )) return "harness";

  if (name.includes("quarter")) return "quarter-horse";

  return "unknown";
}

export function isThoroughbred(type: TrackType): boolean {
  return type === "thoroughbred-major"
      || type === "thoroughbred-minor"
      || type === "thoroughbred-international";
}

export function isFanduelBettable(type: TrackType): boolean {
  // FanDuel Racing carries US thoroughbred + commingled international flats
  // through TVG. Harness coverage is spotty and not all states. Recommend
  // thoroughbred for confidence.
  return type === "thoroughbred-major"
      || type === "thoroughbred-minor"
      || type === "thoroughbred-international";
}

// Short label + tone hint for the UI chip. Kept here so every consumer
// (race radar row, race header, tickets) renders the same badge.
export function trackTypeBadge(type: TrackType | undefined): { label: string; tone: "tb" | "harness" | "qh" | "intl" | "unknown" } {
  switch (type) {
    case "thoroughbred-major":         return { label: "TB",       tone: "tb" };
    case "thoroughbred-minor":         return { label: "TB",       tone: "tb" };
    case "thoroughbred-international": return { label: "TB INTL",  tone: "tb" };
    case "harness":                    return { label: "HARNESS",  tone: "harness" };
    case "quarter-horse":              return { label: "QH",       tone: "qh" };
    case "international":              return { label: "INTL",     tone: "intl" };
    default:                           return { label: "?",        tone: "unknown" };
  }
}
