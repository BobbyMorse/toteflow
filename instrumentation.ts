// Next.js runs this once at server startup (before any request lands). We use
// it to boot the autobook + grader engines so their heartbeats start ticking
// as soon as the Fly container comes up — otherwise the modules would sit
// unimported until the first request to /api/autobook or /api/stream, and no
// bets would be recorded overnight when nobody has the browser open.
//
// The node-only imports live in a separate file so webpack does not try to
// pull `better-sqlite3`, `fs`, and `path` into the edge-runtime bundle. A
// bare `if (process.env.NEXT_RUNTIME !== "nodejs") return; await import(...)`
// pattern still fails `next dev` because the edge bundle is built regardless
// of whether the branch is reachable at runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
