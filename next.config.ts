import type { NextConfig } from "next";

// basePath is set at build time via NEXT_BASE_PATH. Production serves at the
// domain root (toteflow.evqbet.com), so it stays unset; the knob remains for
// running behind a path-prefixing proxy if that's ever needed again.
const basePath = process.env.NEXT_BASE_PATH || "";

const config: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // better-sqlite3 is a native binding — Next.js must not try to bundle it
  serverExternalPackages: ["better-sqlite3"],
  // Minimal self-contained server bundle for the Fly Docker image
  output: "standalone",
  basePath,
  // Expose basePath to client code so raw fetch()/EventSource callers can
  // prefix it (Next.js only rewrites next/link + next/image automatically).
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // EVQBet embeds ToteFlow in an iframe on evqbet.com. frame-ancestors
  // supersedes X-Frame-Options (which Next.js does not set); without this
  // header browsers with a default-deny CSP would refuse to render the
  // embed, and it documents exactly who may frame us.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://evqbet.com https://www.evqbet.com",
          },
        ],
      },
    ];
  },
};

export default config;
