// Node-runtime-only tail of instrumentation.ts. Split out so webpack does not
// try to bundle the SQLite / fs / path chain for the edge runtime — the
// dynamic `await import()` guard in instrumentation.ts wasn't enough to stop
// the edge bundle from failing to resolve `path` during `next dev`.
import "./lib/autobook";
import "./lib/grader";
