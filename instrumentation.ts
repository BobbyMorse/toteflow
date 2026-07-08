// Next.js runs this once at server startup (before any request lands). We use
// it to boot the autobook + grader engines so their heartbeats start ticking
// as soon as the Fly container comes up — otherwise the modules would sit
// unimported until the first request to /api/autobook or /api/stream, and no
// bets would be recorded overnight when nobody has the browser open.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./lib/autobook");
  await import("./lib/grader");
}
