import { NextResponse } from "next/server";

// Returns the raw TVG GraphQL response. Lets users see exactly what we
// pull from upstream — no parsing, no smoothing. Proof the data is real.

export const dynamic = "force-dynamic";

const ENDPOINT = "https://service.tvg.com/graph/v2/query";
const QUERY = `{
  races {
    id number trackCode trackName mtp postTime distance
    status { code name }
    bettingInterests {
      biNumber saddleColor favorite
      currentOdds { numerator denominator }
      morningLineOdds { numerator denominator }
      runners { horseName jockey trainer scratched winProbability }
    }
    pools { amount wagerType { code name } }
  }
}`;

export async function GET() {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ToteFlow/0.1 (+local)",
        "Accept": "application/json",
      },
      body: JSON.stringify({ query: QUERY }),
      cache: "no-store",
    });
    const json = await res.json();
    return NextResponse.json({
      upstreamEndpoint: ENDPOINT,
      upstreamQuery: QUERY,
      fetchedAt: new Date().toISOString(),
      raceCount: json?.data?.races?.length ?? 0,
      raw: json,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
