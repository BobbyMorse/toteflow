// Discord webhook notifier for tvg-steam bet opportunities. Fires a message
// into a channel the moment a steam-confirm ticket promotes (the strategy's
// "this is a bet" instant — market has crushed the model's pick 15-35% from
// stage-time odds). Fire-and-forget: never throws into the autobook tick, and
// no-ops silently when the webhook URL isn't configured so local dev and CI
// don't need the secret.
//
// The webhook URL lives in DISCORD_STEAM_WEBHOOK_URL (Fly secret in prod,
// .env.local for dev) rather than in source — this repo is headed for public,
// and a committed webhook URL lets anyone spam the channel.

const WEBHOOK_URL = process.env.DISCORD_STEAM_WEBHOOK_URL;

export interface SteamAlert {
  strategyId: string;
  trackCode: string;
  raceNumber: number;
  trackName?: string;
  program: string;
  horseName?: string;
  fractionalOdds: string;
  decimalOdds: number;
  evPercent: number;
  crushPct: number;
  stageOdds: number;
  reason?: string;
  shadow?: boolean;
}

// Discord green for a live pick; grey when it's a shadow (another strategy
// already holds the real bet on this selection, so it's informational).
function color(shadow?: boolean): number {
  return shadow ? 0x9aa0a6 : 0x1db954;
}

export function sendSteamAlert(a: SteamAlert): void {
  if (!WEBHOOK_URL) return;

  const evStr = `${a.evPercent >= 0 ? "+" : ""}${a.evPercent.toFixed(1)}%`;
  const title =
    `🔥 ${a.trackCode} R${a.raceNumber} · #${a.program} ${a.horseName ?? ""}`.trim();
  const desc =
    `Steam-confirmed WIN @ **${a.fractionalOdds}** (${a.decimalOdds.toFixed(2)})\n` +
    `Late crush **${a.crushPct.toFixed(0)}%** (${a.stageOdds.toFixed(1)} → ${a.decimalOdds.toFixed(1)}) · ` +
    `fire EV **${evStr}**` +
    (a.shadow ? `\n_shadow — another strategy already holds this pick_` : "");

  const payload = {
    username: "ToteFlow Steam",
    embeds: [
      {
        title,
        description: desc,
        color: color(a.shadow),
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
