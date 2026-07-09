# ToteFlow

Live tote market intelligence and strategy-validation harness for horse racing.
Trading-terminal aesthetic, real-time phase shifts (Discovery → Action → Chaos),
strategy framework with per-strategy CLV tracking, auto-booked paper tickets,
and SQLite persistence so multi-week experiments survive restarts.

> Not a "pick winners" app. A real-time market intelligence + edge-validation
> system. You bring a thesis; ToteFlow measures whether it actually has an edge.

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS + Framer Motion
- Zustand client store
- SQLite via `better-sqlite3` (data at `data/toteflow.db`)
- Server-Sent Events for live ticks

## Run
```bash
npm install
npm run dev
```
Open http://localhost:3000.

## Data Provider
Only TVG. Adapter lives in [lib/adapters/tvg.ts](lib/adapters/tvg.ts) — hits TVG's
open GraphQL endpoint, no auth. TVG carries US, AU, and commingled international
thoroughbred pools; that's the whole universe the app models.

Booking: FanDuel Racing (same parent as TVG, same pools). Bet cards deep-link to
racing.fanduel.com. FanDuel Racing / DK Horse results pages are used for results
verification.

## Strategy Framework
Strategies live in [lib/strategies/](lib/strategies/). Each one implements `evaluate(race) → eval | null`.
Built-in strategies:

| Strategy | Thesis |
|---|---|
| `tvg-baseline` | Trust TVG&apos;s winProbability model when modelQuality is high |
| `overlay-vs-ml` | Bet horses whose current odds drift 50%+ above morning line |
| `fav-fade` | Fade heavy favorites in deep fields; bet the 2nd choice |
| `late-steam` | Bet runners whose odds dropped 12%+ in the last 60s on liquid pools |
| `lone-speed` | Shell — needs pace-rating data |
| `pass-control` | Never bets — control group |

## Persistence
SQLite at `data/toteflow.db`. Every ticket, strategy config, and bookkeeping flag
survives restart so multi-week experiments work.

## Analysis
- **In-app:** `/stats` page — leaderboard with 95% CI on ROI, cumulative P/L chart, per-track breakdown, captured-EV vs realized calibration audit
- **CLI:** `npx tsx scripts/analyze.ts` — full SQL-backed text report
- **CSV:** `GET /api/debug/export-tickets` — downloads every ticket
- **SQL:** `sqlite3 data/toteflow.db` — open the raw DB

## Notes on US betting placement
FanDuel Racing does not expose a betting API to retail. Each open bet card
deep-links directly to the race's bet slip on racing.fanduel.com
(`/racetracks/{TRK}/{track-slug}?race={N}`) so you land already on the right
race — pick horses, enter the wager, confirm. There is no way to auto-fire
the confirm click; parimutuel books don't publish prefill-amount schemes and
retail sessions are cookie-authed.
Strategy validation happens in paper mode against real TVG odds and the
post-race view of the same URL, which shows finish order + payoffs.
