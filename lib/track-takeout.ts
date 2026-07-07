// Per-track takeout lookup. US racetracks publish their pari-mutuel takeout
// rates with the state racing commission — these numbers are stable across
// meets (rates change rarely, typically only when a state legislature acts).
// Source: track condition books / state racing commission filings, current
// as of 2025. Update when rates change.
//
// Three pools tracked:
//   - WIN  (straight wager)
//   - PLACE/SHOW combined (typically 1-3pt higher than WIN)
//   - EXOTIC (EX/TR/DB/P3/P4 etc — usually 5-10pt higher than WIN)
//
// When a track isn't in the table we fall back to the country average via
// `countryFallback()` — which is what the adapter has always done.

interface TrackTakeout {
  win: number;
  place: number;
  exotic: number;
}

// Sorted alphabetically by code for easy maintenance.
const US_TRACK_TAKEOUT: Record<string, TrackTakeout> = {
  AP:  { win: 0.17,    place: 0.205,  exotic: 0.255  },  // Arlington
  AQU: { win: 0.16,    place: 0.175,  exotic: 0.24   },  // Aqueduct (NYRA)
  BEL: { win: 0.16,    place: 0.175,  exotic: 0.24   },  // Belmont (NYRA)
  BTP: { win: 0.18,    place: 0.18,   exotic: 0.22   },  // Belterra
  CD:  { win: 0.175,   place: 0.22,   exotic: 0.22   },  // Churchill Downs
  CHU: { win: 0.175,   place: 0.22,   exotic: 0.22   },  // Churchill Downs (alt code)
  CT:  { win: 0.17,    place: 0.19,   exotic: 0.25   },  // Charles Town
  DED: { win: 0.17,    place: 0.20,   exotic: 0.25   },  // Delta Downs
  DEL: { win: 0.17,    place: 0.19,   exotic: 0.205  },  // Delaware Park
  DMR: { win: 0.1543,  place: 0.1543, exotic: 0.2368 },  // Del Mar
  ELP: { win: 0.16,    place: 0.16,   exotic: 0.19   },  // Ellis Park
  FG:  { win: 0.17,    place: 0.17,   exotic: 0.22   },  // Fair Grounds
  FL:  { win: 0.17,    place: 0.18,   exotic: 0.215  },  // Finger Lakes
  FMT: { win: 0.18,    place: 0.18,   exotic: 0.22   },  // Fairmount
  FP:  { win: 0.17,    place: 0.20,   exotic: 0.205  },  // Fairmount Park (alt)
  GG:  { win: 0.1543,  place: 0.1543, exotic: 0.2368 },  // Golden Gate
  GP:  { win: 0.17,    place: 0.19,   exotic: 0.21   },  // Gulfstream Park
  GPW: { win: 0.17,    place: 0.19,   exotic: 0.21   },  // Gulfstream West
  HAW: { win: 0.17,    place: 0.205,  exotic: 0.255  },  // Hawthorne
  HOU: { win: 0.18,    place: 0.21,   exotic: 0.25   },  // Sam Houston
  IND: { win: 0.18,    place: 0.205,  exotic: 0.22   },  // Indiana Grand
  KEE: { win: 0.175,   place: 0.19,   exotic: 0.22   },  // Keeneland
  LAD: { win: 0.17,    place: 0.20,   exotic: 0.25   },  // Louisiana Downs
  LRC: { win: 0.1543,  place: 0.1543, exotic: 0.2368 },  // Los Alamitos (TB)
  LRL: { win: 0.18,    place: 0.18,   exotic: 0.2575 },  // Laurel Park
  LS:  { win: 0.18,    place: 0.21,   exotic: 0.25   },  // Lone Star
  MED: { win: 0.17,    place: 0.19,   exotic: 0.19   },  // Meadowlands (TB days)
  MNR: { win: 0.1725,  place: 0.1725, exotic: 0.25   },  // Mountaineer
  MTH: { win: 0.17,    place: 0.19,   exotic: 0.19   },  // Monmouth
  OP:  { win: 0.17,    place: 0.20,   exotic: 0.22   },  // Oaklawn
  PEN: { win: 0.17,    place: 0.17,   exotic: 0.26   },  // Penn National
  PID: { win: 0.16,    place: 0.20,   exotic: 0.23   },  // Presque Isle
  PIM: { win: 0.18,    place: 0.18,   exotic: 0.2575 },  // Pimlico
  PRM: { win: 0.18,    place: 0.20,   exotic: 0.22   },  // Prairie Meadows
  PRX: { win: 0.17,    place: 0.17,   exotic: 0.30   },  // Parx
  RP:  { win: 0.18,    place: 0.18,   exotic: 0.22   },  // Remington
  SA:  { win: 0.1543,  place: 0.1543, exotic: 0.2368 },  // Santa Anita
  SAR: { win: 0.16,    place: 0.175,  exotic: 0.24   },  // Saratoga (NYRA)
  TAM: { win: 0.185,   place: 0.185,  exotic: 0.26   },  // Tampa Bay Downs
  TDN: { win: 0.18,    place: 0.18,   exotic: 0.22   },  // Thistledown
  TP:  { win: 0.16,    place: 0.16,   exotic: 0.19   },  // Turfway Park
  WO:  { win: 0.16,    place: 0.19,   exotic: 0.25   },  // Woodbine
  WRD: { win: 0.18,    place: 0.18,   exotic: 0.22   },  // Will Rogers Downs
};

// Country-level fallback when track isn't in the table. Mirrors the original
// `takeoutFor` in the TVG adapter so behavior degrades gracefully.
function countryFallback(country: string): TrackTakeout {
  if (country === "AU" || country === "HK") return { win: 0.175, place: 0.20, exotic: 0.225 };
  if (country === "GB" || country === "IE") return { win: 0.10,  place: 0.10, exotic: 0.10  };
  if (country === "FR") return { win: 0.13,  place: 0.13, exotic: 0.21 };
  return { win: 0.16, place: 0.18, exotic: 0.23 }; // US average
}

export function takeoutForTrack(trackCode: string, country: string): TrackTakeout {
  const hit = US_TRACK_TAKEOUT[trackCode?.toUpperCase()];
  if (hit) return hit;
  return countryFallback(country);
}

// Most consumers only need the WIN takeout (Race.takeout). PLACE/SHOW and
// exotic-pool callers can read the wider object via takeoutForTrack().
export function winTakeoutForTrack(trackCode: string, country: string): number {
  return takeoutForTrack(trackCode, country).win;
}
