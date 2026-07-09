// Deep links so users can (a) actually book the bet on FanDuel Racing and
// (b) confirm the race in the app matches the TVG live view. TVG is an SPA
// so deep links are unreliable — landing pages are stable.

export interface VerifyLink {
  label: string;
  url: string;
  description: string;
}

export function verificationLinks(opts: {
  source: string;
  trackCode: string;
  raceNumber: number;
  postTime: number;
}): VerifyLink[] {
  const { source, trackCode, raceNumber } = opts;
  const links: VerifyLink[] = [];

  if (source === "tvg") {
    links.push({
      label: "FanDuel Racing 💰",
      url: `https://racing.fanduel.com/?utm_source=toteflow#/schedule`,
      description: `Place this bet on FanDuel Racing (manual — log in, find ${trackCode} R${raceNumber}, wager)`,
    });
    links.push({
      label: "📺 Watch Live (FanDuel)",
      url: `https://racing.fanduel.com/?utm_source=toteflow#/live`,
      description: `Live simulcast (requires funded FanDuel Racing account)`,
    });
    links.push({
      label: "📺 Watch Live (TVG)",
      url: `https://www.tvg.com/live`,
      description: `Live simulcast (requires TVG account)`,
    });
    links.push({
      label: "📺 XBTV Free",
      url: `https://xbtv.com/`,
      description: `Free thoroughbred simulcast — limited tracks, no login`,
    });
    links.push({
      label: "TVG/FanDuel Live",
      url: `https://www.tvg.com/racetracks`,
      description: `Same backend as FanDuel — search ${trackCode}`,
    });
    links.push({
      label: "FanDuel Result",
      url: `https://racing.fanduel.com/?utm_source=toteflow#/results`,
      description: `Find ${trackCode} R${raceNumber} in FanDuel Racing results`,
    });
    links.push({
      label: "DK Horse Result",
      url: `https://dkhorse.com/results`,
      description: `DraftKings Horse results — find ${trackCode} R${raceNumber}`,
    });
  }

  return links;
}
