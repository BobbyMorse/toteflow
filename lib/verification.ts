// Deep links to source-of-truth providers so users can confirm a race in
// the app is the same race showing on TVG / Equibase / HKJC. URLs are
// best-effort — TVG is an SPA so deep links are unreliable, but landing
// pages are stable.

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
  const { source, trackCode, raceNumber, postTime } = opts;
  const dateMmDdYyyy = formatDateMmDdYyyy(postTime);
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
      label: "Equibase Entries",
      url: `https://www.equibase.com/profiles/EntriesResults.cfm?type=Entry&trk=${encodeURIComponent(trackCode)}&cy=USA`,
      description: `Track ${trackCode} entries — canonical source`,
    });
    links.push({
      label: "Equibase Result",
      url: `https://www.equibase.com/profiles/Results.cfm?type=Race&trk=${encodeURIComponent(trackCode)}&cy=USA&dt=${encodeURIComponent(dateMmDdYyyy)}&rn=${raceNumber}`,
      description: `Race ${raceNumber} result — official chart`,
    });
  }

  if (source === "hkjc") {
    links.push({
      label: "HKJC Race Card",
      url: `https://racing.hkjc.com/racing/info/meeting/RaceCard/english/Local/`,
      description: `Today's HKJC meeting`,
    });
    links.push({
      label: "HKJC Result",
      url: `https://racing.hkjc.com/racing/information/english/racing/LocalResults.aspx`,
      description: `Local results`,
    });
  }

  if (source === "racingapi") {
    links.push({
      label: "RacingPost",
      url: `https://www.racingpost.com/racecards/`,
      description: `Cross-check on Racing Post`,
    });
  }

  return links;
}

function formatDateMmDdYyyy(epochMs: number): string {
  const d = new Date(epochMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}
