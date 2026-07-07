// Prefix raw fetch()/EventSource paths with the configured basePath so they
// resolve correctly when ToteFlow is mounted under a proxy prefix
// (e.g. NEXT_BASE_PATH=/toteflow in production behind EVQBet).
//
// next/link and next/image already handle basePath automatically — this helper
// is only for the handful of call sites that hit "/api/..." directly.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return BASE + "/" + path;
  return BASE + path;
}
