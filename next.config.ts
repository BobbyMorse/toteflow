import type { NextConfig } from "next";

// basePath is set at build time via NEXT_BASE_PATH. In production behind the
// EVQBet Flask proxy this is "/toteflow" so all Next-generated URLs
// (_next/static/*, next/link hrefs, etc.) are self-consistent under the
// proxy prefix. Local dev leaves it unset so the app runs at http://localhost:3000/.
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
};

export default config;
