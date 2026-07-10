import type { Strategy } from "./types";
import type { Discipline } from "../track-types";

// Build a same-code, different-discipline variant of a base strategy. Keeps
// the exact evaluate/thesis logic — only id, display name, and appliesTo change.
// This is how we spin up per-breed strategy groups (harness, quarter-horse)
// without duplicating any code. Each variant gets its own strategy config
// (enabled/threshold/stake/phase) so users can tune per-breed independently
// and per-breed P&L stays isolated.
export function variantStrategy(
  base: Strategy,
  opts: { discipline: Discipline; idSuffix: string; nameSuffix: string },
): Strategy {
  return {
    ...base,
    id: `${base.id}-${opts.idSuffix}`,
    name: `${base.name} ${opts.nameSuffix}`,
    appliesTo: [opts.discipline],
  };
}
