// Classify races so strategies can filter by discipline and by what's
// realistically bettable on major US ADWs (FanDuel Racing, TVG, TwinSpires).
//
// Classification is two-tier:
//   1. classifyRace() — per-race, from TVG's own feed data (breed enum,
//      isGreyhound flag, race-class code, description). Authoritative: it
//      correctly handles mixed cards (a track that runs flat in the afternoon
//      and trot at night, or flat/hurdle on the same card) that no venue
//      table ever could.
//   2. classifyTrack() — name/code heuristics. Fallback only, for contexts
//      where the feed's breed fields are unavailable.

export type TrackType =
  | "thoroughbred-major"          // BEL, GP, CD, SA, etc.
  | "thoroughbred-minor"          // PRM, EMD, MNR, FRT, etc.
  | "thoroughbred-international"  // flat thoroughbred abroad — TVG/FanDuel carries it via commingled pools
  | "harness"                     // standardbred trot/pace — US harness + European trot
  | "quarter-horse"               // LA, RD — different breed, short sprints
  | "jumps"                       // hurdle/chase/NH — flat model can't read falls, refusals, soft going
  | "greyhound"                   // dogs — no horse strategy applies
  | "international"               // unclassifiable international — legacy value, skip
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

// International tracks whose meets are exclusively or predominantly jumps
// (steeplechase / hurdle). Fallback only — when the feed's race-class code is
// available, classifyRace() decides flat-vs-jumps per race, so mixed cards
// (Ayr, Musselburgh flat days) are handled correctly there.
const INTERNATIONAL_JUMPS_NAMES = new Set([
  // UK National Hunt only
  "cartmel","exeter","fakenham","fontwell","hexham","huntingdon","kelso","ludlow",
  "market rasen","newton abbot","plumpton","sedgefield","stratford","taunton",
  "towcester","warwick","wetherby","wincanton","worcester","bangor","hereford",
  "uttoxeter","perth",
  // UK predominantly NH (mixed cards — skip to be safe when no per-race data)
  "aintree","cheltenham","ayr","musselburgh",
  // IE NH-only or predominantly
  "thurles","clonmel","fairyhouse","punchestown","navan","kilbeggan","downpatrick",
  // FR jumps
  "auteuil",
]);

// Countries whose TVG meets are trot (standardbred) racing — same discipline
// as US harness, so harness strategies get them instead of a blanket skip.
// Exception: the Nordic flat-galopp venues below.
const TROT_COUNTRIES = new Set(["SE","NO","DK","FI"]);

// The Nordics' few flat thoroughbred courses. Everything else SE/NO/DK/FI on
// the feed is trot. (Finland has no thoroughbred racing at all.)
const NORDIC_GALOPP_NAMES = new Set([
  "ovrevoll","klampenborg","bro park","goteborg","jagersro galopp","taby",
]);

// France is flat-whitelisted, but these venues are trot-only — without the
// carve-out thoroughbred strategies would fire on trot races. (Measured: 16
// bets at Enghien/Cabourg before this existed, 0 wins, -$320.) Fallback only;
// the feed's breed enum catches every French trot race regardless of venue.
const FRENCH_TROT_NAMES = new Set([
  "vincennes","enghien","cabourg","caen","laval","cordemais","mauquenchy",
  "graignes","cherbourg","argentan",
]);

// Jumps detection from TVG's race-class code. International thoroughbred
// races carry codes like "Z-G-F" / "Z-I-H" / "Z-PM-N": the last letter is the
// race discipline — F = Flat; H = Hurdle, C = Chase, N = NH flat (bumper),
// S = steeplechase. Anything non-F is a National Hunt race.
const JUMPS_CLASS_RE = /^Z-[A-Z]+-([A-Z])$/;
// Description keywords as a second net (catches US steeplechase cards and
// French jumps, where "haies" = hurdles).
const JUMPS_DESC_RE = /\b(hurdle|steeplechase|steeple chase|national hunt|haies)\b/i;

export interface RaceClassificationInput {
  trackCode: string;
  trackName?: string | null;
  /** TVG race type enum code: T = Thoroughbred, H = Harness, Q = QuarterHorse, L = Thoroughbred LARC (Latin America). */
  breedCode?: string | null;
  isGreyhound?: boolean | null;
  /** TVG raceClass code, e.g. "CLM", "Z-G-F", "Z-P-H". */
  raceClassCode?: string | null;
  description?: string | null;
}

// Per-race classification from the feed's own breed/class data. Falls back to
// classifyTrack() name heuristics when the feed omits the breed enum.
export function classifyRace(input: RaceClassificationInput): TrackType {
  const { trackCode, trackName, breedCode, isGreyhound, raceClassCode, description } = input;
  if (isGreyhound) return "greyhound";

  const isJumps =
    (() => {
      const m = JUMPS_CLASS_RE.exec((raceClassCode ?? "").trim());
      if (m) return m[1] !== "F";
      return JUMPS_DESC_RE.test(description ?? "");
    })();

  switch ((breedCode ?? "").trim().toUpperCase()) {
    case "H": return "harness";
    case "Q": return "quarter-horse";
    case "L": return isJumps ? "jumps" : "thoroughbred-international"; // LARC = Latin American flat
    case "T": {
      if (isJumps) return "jumps";
      // Breed is authoritative; the name-based pass only sets granularity.
      const byName = classifyTrack(trackCode, trackName ?? undefined);
      if (isThoroughbred(byName)) return byName;
      // Name heuristics disagree (e.g. a Nordic galopp day at a trot venue,
      // or an unlisted US track) — trust the feed's breed.
      return /^[A-Z]{2}\s*-\s*/.test(trackName ?? "") ? "thoroughbred-international" : "thoroughbred-minor";
    }
    default: {
      const byName = classifyTrack(trackCode, trackName ?? undefined);
      // Even without a breed enum, an explicit jumps class code is decisive.
      if (isJumps && isThoroughbred(byName)) return "jumps";
      return byName;
    }
  }
}

// Name/code heuristics — fallback when no per-race feed data is available.
export function classifyTrack(trackCode: string, trackName?: string): TrackType {
  const code = trackCode.toUpperCase();
  const name = (trackName ?? "").toLowerCase();

  // International prefixes from TVG's naming: "GB - ", "AU - ", "JP - ", etc.
  // Flat thoroughbred is the default for named international meets — the
  // carve-outs route trot to the harness group and jumps venues to jumps.
  const intlMatch = (trackName ?? "").match(/^([A-Z]{2})\s*-\s*(.+)$/);
  if (intlMatch) {
    const country = intlMatch[1].toUpperCase();
    const trackOnly = intlMatch[2].trim().toLowerCase();
    if (TROT_COUNTRIES.has(country) && !NORDIC_GALOPP_NAMES.has(trackOnly)) return "harness";
    if (country === "FR" && FRENCH_TROT_NAMES.has(trackOnly)) return "harness";
    if (INTERNATIONAL_JUMPS_NAMES.has(trackOnly)) return "jumps";
    return "thoroughbred-international";
  }
  // International sim codes with no country-prefixed name: overwhelmingly
  // flat thoroughbred (AU/JP/etc. simulcasts).
  if (/^(L\d|A\d|S\d|AU\d|BT|JP|GG|VM|LY|HX|BS|PJ|KAL|XKD)/.test(code)) return "thoroughbred-international";

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

// Coarser grouping for strategy scoping. Strategies declare which disciplines
// they apply to via `Strategy.appliesTo`; the autobook uses this to gate races
// before evaluation, so a thoroughbred strategy never sees a harness card and
// vice-versa. Keeps discipline-specific strategy groups isolated so adding a
// harness or jumps group can't contaminate the thoroughbred P&L.
export type Discipline = "thoroughbred" | "harness" | "quarter-horse" | "jumps";

export function disciplineOfTrack(type: TrackType | undefined): Discipline | null {
  switch (type) {
    case "thoroughbred-major":
    case "thoroughbred-minor":
    case "thoroughbred-international":
      return "thoroughbred";
    case "harness":         return "harness";
    case "quarter-horse":   return "quarter-horse";
    case "jumps":           return "jumps";
    default:                return null; // greyhound / international / unknown never match a strategy
  }
}

export function strategyAppliesToTrack(
  appliesTo: readonly Discipline[] | undefined,
  trackType: TrackType | undefined,
): boolean {
  const d = disciplineOfTrack(trackType);
  if (!d) return false;
  if (!appliesTo || appliesTo.length === 0) return false;
  return appliesTo.includes(d);
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
    case "jumps":                      return { label: "JUMPS",    tone: "intl" };
    case "greyhound":                  return { label: "DOGS",     tone: "unknown" };
    case "international":              return { label: "INTL",     tone: "intl" };
    default:                           return { label: "?",        tone: "unknown" };
  }
}
