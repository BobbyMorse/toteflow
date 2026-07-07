// Per-track + per-wager minimum base bet. Two sources feed the booker:
//   1. The live tote feed's `wagerTypes { minWagerAmount }` field (via the
//      TVG adapter → Race.wagerMinimums → CarryoverOpportunity.minWagerAmount)
//   2. This file's defaults + verified per-track overrides
// The booker takes the MAX of (1) and (2) so verified overrides can never
// be undercut. The feed often reports a legacy per-combo floor (e.g. $0.50)
// while the ADW actually enforces a higher per-ticket minimum (e.g. CD P3 =
// $3.00). Overrides below are populated from real FanDuel rejections.
//
// Defaults reflect the most common US minimum per wager type. Per-track
// entries override when we have hard evidence (typically verified by hitting
// the wager in the FanDuel custom-amount panel and observing the floor).

type WagerCode = "P3" | "P4" | "P5" | "P6" | "J6";

// Wager-type defaults — what most US tracks publish.
const DEFAULT_MIN_BASE: Record<WagerCode, number> = {
  P3: 0.50,
  P4: 0.50,
  P5: 0.50,
  P6: 2.00,
  J6: 0.20,
};

// Per-track overrides. Only add an entry when you have evidence from an
// actual paid ticket (FanDuel charging more than we displayed) — NOT from
// the custom-amount input panel, which can show different floors than the
// real wager builder uses. False overrides over-charge silently and are
// hard to spot, so the bar for adding one is high.
const TRACK_OVERRIDES: Record<string, Partial<Record<WagerCode, number>>> = {
  // Los Alamitos Thoroughbred — confirmed by user 2026-06-28 attempting to
  // place a 4-combo P3 we displayed as $2.00 ($0.50 base) and FanDuel charging
  // ~$12 ($3.00 base × 4 combos).
  LRC: { P3: 3.00 },
};

const FALLBACK = 0.50;

export function minBaseForWager(trackCode: string | undefined, wagerType: string | undefined): number {
  if (!wagerType) return FALLBACK;
  const wt = wagerType.toUpperCase() as WagerCode;
  if (trackCode) {
    const override = TRACK_OVERRIDES[trackCode.toUpperCase()]?.[wt];
    if (override != null) return override;
  }
  return DEFAULT_MIN_BASE[wt] ?? FALLBACK;
}
