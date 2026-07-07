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

## Data Providers
Adapter pattern in [lib/adapters/](lib/adapters/). All real upstream feeds:

| Provider | Status | How to enable |
|---|---|---|
| TVG (US/AU/INT&apos;L) | live | open GraphQL — already wired |
| The Racing API (UK/IRE) | needs key | set `RACING_API_USER` / `RACING_API_PASS` in `.env.local` |
| Betfair Exchange | needs key | set `BETFAIR_APP_KEY` / `BETFAIR_SESSION_TOKEN` |
| HKJC | needs HTML parser | implement `listRaces()` in [lib/adapters/hkjc.ts](lib/adapters/hkjc.ts) |
| Equibase entries | needs scraper | implement `listRaces()` in [lib/adapters/equibase.ts](lib/adapters/equibase.ts) |
| TwinSpires / FanDuel / NYRA / AmWager | needs scraper | implement `listRaces()` in respective files |

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
TVG, FanDuel Racing, TwinSpires, NYRA Bets, AmWager — none expose betting APIs to retail.
ToteFlow surfaces deep links to FanDuel Racing&apos;s site on each open bet card, but you
place the bet manually (log in, find the race, wager). Strategy validation happens in
paper mode against real TVG odds and real Equibase results.
