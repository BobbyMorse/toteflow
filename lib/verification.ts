// Deep links so users can (a) actually book the bet on FanDuel Racing and
// (b) confirm the race in the app matches the TVG live view. FanDuel Racing's
// SPA exposes a race-specific route:
//   /racetracks/{TRK}/{track-slug}?race={N}
// which loads the bet slip / results view for that exact race. That's as
// close to auto-placement as the retail UI allows — no public betting API
// exists for parimutuel, so the user still clicks Confirm.
//
// DK Horse has no crawlable race-specific URL scheme, so we don't try to
// deep-link there.

export interface VerifyLink {
  label: string;
  url: string;
  description: string;
}

export function verificationLinks(opts: {
  source: string;
  trackCode: string;
  trackName?: string;
  raceNumber: number;
  postTime: number;
}): VerifyLink[] {
  const { source, trackCode, trackName, raceNumber } = opts;
  const links: VerifyLink[] = [];

  if (source === "tvg") {
    const raceUrl = fanduelRaceUrl(trackCode, trackName, raceNumber);
    links.push({
      label: "FanDuel Racing 💰",
      url: raceUrl,
      description: `Deep link to ${trackCode} R${raceNumber} bet slip on FanDuel Racing — pick horses, confirm wager`,
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
      label: "FanDuel Result",
      url: raceUrl,
      description: `Race ${raceNumber} result — same URL, post-race view shows finish + payoffs`,
    });
  }

  return links;
}

// Build the FanDuel Racing race-specific URL. The SPA uses
// /racetracks/{code}/{slug}?race={n}. Slug is derived from trackName by
// lowercasing, hyphenating, and stripping the "AU - ", "INT - ", "UK - "
// international prefixes we get from TVG. When trackName is missing we
// fall back to a code-only path — FanDuel's SPA appears to handle it, but
// the URL will look ugly.
export function fanduelRaceUrl(trackCode: string, trackName: string | undefined, raceNumber: number): string {
  const code = encodeURIComponent(trackCode);
  const slug = trackName ? slugifyTrack(trackName) : trackCode.toLowerCase();
  return `https://racing.fanduel.com/racetracks/${code}/${encodeURIComponent(slug)}?race=${raceNumber}&utm_source=toteflow`;
}

function slugifyTrack(name: string): string {
  return name
    .replace(/^(AU|INT|UK|IE|GB|FR|JP|HK|CA)\s*-\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
