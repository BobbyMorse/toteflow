// Discord webhook notifier for tvg-steam bet opportunities.
//
// Two events per opportunity:
//   - "surfaced": the strategy has STAGED a pick (model diverges from market).
//     This is the lead-time alert — the bet isn't live yet; it fires only if
//     late money crushes the price into the 15-35% band. The alert links to the
//     race page so the user can watch the odds and decide whether to fire it
//     themselves.
//   - "fired": the strategy promoted the ticket (crush confirmed) — the paper
//     bet went down at this price. Confirmation, not lead time.
//
// Fire-and-forget: never throws into the autobook tick, and no-ops silently
// when DISCORD_STEAM_WEBHOOK_URL isn't set so local dev / CI don't need it.
//
// URL secrets/config live in env (Fly secret / .env.local), not source — this
// repo is headed public and a committed webhook URL lets anyone spam the
// channel.

const WEBHOOK_URL = process.env.DISCORD_STEAM_WEBHOOK_URL;
// Public origin of the deployed app, for building monitor links. Production
// serves at toteflow.evqbet.com (see next.config.ts); override per-env.
const PUBLIC_URL = (process.env.TOTEFLOW_PUBLIC_URL || "https://toteflow.evqbet.com").replace(/\/+$/, "");

export interface SteamAlert {
  kind: "surfaced" | "fired";
  strategyId: string;
  raceId: string;            // e.g. "BEL-6" — for the monitor link
  trackCode: string;
  raceNumber: number;
  trackName?: string;
  program: string;
  horseName?: string;
  fractionalOdds: string;
  decimalOdds: number;
  evPercent: number;
  trueP?: number;            // model win prob (surfaced)
  crushPct?: number;         // late crush at fire (fired)
  stageOdds?: number;        // stage-time odds, for the crush trail (fired)
  reason?: string;
  shadow?: boolean;
}

// Amber while we're watching a surfaced pick; green when it fires; grey for a
// shadow fire (another strategy already holds the real bet on this selection).
function color(a: SteamAlert): number {
  if (a.kind === "surfaced") return 0xf5a623;
  return a.shadow ? 0x9aa0a6 : 0x1db954;
}

function monitorUrl(raceId: string): string {
  return `${PUBLIC_URL}/race/${encodeURIComponent(raceId)}`;
}

// Cross-variant dedup. The tvg-steam family runs four strategies in parallel
// (tvg-steam plus -value / -closing-gate / -overbet-guard controls) that stage
// and fire on essentially the same picks — so without this each opportunity
// pinged Discord up to four times. The channel is a human feed that only needs
// one alert per pick per event; the per-strategy breakdown lives on the site.
// Key on (kind, raceId, program) — NOT strategyId — so the first variant to
// surface/fire a pick alerts and the rest no-op. Different `kind` (surfaced vs
// fired) keeps its own slot, so a pick still gets both the lead-time and the
// confirmation ping. raceId is trackCode-raceNumber (unique within a day), so a
// few-hours TTL covers a race's stage→fire lifecycle without suppressing the
// same id on a later day.
const DEDUP_TTL_MS = 6 * 60 * 60 * 1000;
const recentAlerts = new Map<string, number>();

function shouldSuppress(a: SteamAlert, nowMs: number): boolean {
  // Prune expired keys so the map can't grow unbounded in a long-lived process.
  for (const [k, expiry] of recentAlerts) {
    if (expiry <= nowMs) recentAlerts.delete(k);
  }
  const key = `${a.kind}:${a.raceId}:${a.program}`;
  if (recentAlerts.has(key)) return true;
  recentAlerts.set(key, nowMs + DEDUP_TTL_MS);
  return false;
}

export function sendSteamAlert(a: SteamAlert): void {
  if (!WEBHOOK_URL) return;
  if (shouldSuppress(a, Date.now())) return;

  const evStr = `${a.evPercent >= 0 ? "+" : ""}${a.evPercent.toFixed(1)}%`;
  const url = monitorUrl(a.raceId);
  const who = `#${a.program} ${a.horseName ?? ""}`.trim();

  let title: string;
  let desc: string;
  if (a.kind === "surfaced") {
    title = `👀 SURFACED · ${a.trackCode} R${a.raceNumber} · ${who}`;
    desc =
      `Model likes this pick @ **${a.fractionalOdds}** (${a.decimalOdds.toFixed(2)}) · model EV **${evStr}**` +
      (a.trueP != null ? ` · model P **${(a.trueP * 100).toFixed(1)}%**` : "") +
      `\nNot a bet yet — fires only if late money crushes the price **15-35%**.` +
      `\n**[Monitor on ToteFlow →](${url})**`;
  } else {
    title = `🔥 FIRED · ${a.trackCode} R${a.raceNumber} · ${who}`;
    const crush = a.crushPct != null && a.stageOdds != null
      ? `\nLate crush **${a.crushPct.toFixed(0)}%** (${a.stageOdds.toFixed(1)} → ${a.decimalOdds.toFixed(1)})`
      : "";
    desc =
      `Steam confirmed — paper bet placed @ **${a.fractionalOdds}** (${a.decimalOdds.toFixed(2)}) · fire EV **${evStr}**` +
      crush +
      (a.shadow ? `\n_shadow — another strategy already holds this pick_` : "") +
      `\n**[View race on ToteFlow →](${url})**`;
  }

  const payload = {
    username: "ToteFlow Steam",
    embeds: [
      {
        title,
        url,
        description: desc,
        color: color(a),
        fields: [
          { name: "Strategy", value: a.strategyId, inline: true },
          { name: "Track", value: a.trackName ?? a.trackCode, inline: true },
        ],
        ...(a.reason ? { footer: { text: a.reason.slice(0, 2000) } } : {}),
      },
    ],
  };

  // Fire-and-forget. Swallow every failure — a Discord outage or a bad
  // webhook must never abort a paper-bet tick or throw an unhandled rejection.
  void fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
