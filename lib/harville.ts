// Stern-discounted Harville finish-order probabilities, shared by the
// in-race exotic strategies (exacta/trifecta staging math).
//
// Raw Harville prices ordered finishes by proportional elimination:
//   P(i 1st, j 2nd) = p_i · p_j/(1 - p_i)
// which assumes a beaten horse keeps its full relative strength. Empirically
// wrong in a systematic direction — beaten favorites finish nowhere more
// often than proportionality implies. Standard correction (Stern 1990; Lo &
// Bacon-Shone 1994): dampen win probs with an exponent < 1 before
// renormalizing each minor placing's contest. Same constants as the
// hand-rolled versions in dr-z-place.ts / bridge-jumper.ts.
export const STERN_LAMBDA_2ND = 0.81;
export const STERN_LAMBDA_3RD = 0.65;

// Factory over a full field of win probabilities (normalized to sum ≈ 1 —
// pass ALL live runners, not just the contenders, so the discounted
// denominators see the whole field).
export function sternHarville(probs: number[]) {
  const s = probs.map(p => Math.pow(Math.max(0, p), STERN_LAMBDA_2ND));
  const u = probs.map(p => Math.pow(Math.max(0, p), STERN_LAMBDA_3RD));
  const S = s.reduce((a, b) => a + b, 0);
  const U = u.reduce((a, b) => a + b, 0);
  return {
    // P(i 1st, j 2nd) = p_i · s_j / (S - s_i)
    pair(i: number, j: number): number {
      return probs[i] * (s[j] / Math.max(1e-6, S - s[i]));
    },
    // P(i 1st, j 2nd, k 3rd) = p_i · s_j/(S - s_i) · u_k/(U - u_i - u_j)
    triple(i: number, j: number, k: number): number {
      return probs[i]
        * (s[j] / Math.max(1e-6, S - s[i]))
        * (u[k] / Math.max(1e-6, U - u[i] - u[j]));
    },
  };
}
