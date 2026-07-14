import { NextRequest, NextResponse } from "next/server";
import {
  handoffConfigured,
  mintSessionToken,
  verifyHandoffToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/evqbet-session";

export const dynamic = "force-dynamic";

const BASE_PATH = process.env.NEXT_BASE_PATH || "";

function errorPage(message: string, status: number): NextResponse {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ToteFlow</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e5e5e5">
<div style="text-align:center;padding:2rem">
<p style="font-size:1.1rem;margin:0 0 .5rem">${message}</p>
<p style="color:#888;margin:0">Reopen ToteFlow from EVQBet to start a new session.</p>
</div>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  if (!handoffConfigured()) {
    return errorPage("ToteFlow handoff is not configured yet.", 503);
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return errorPage("Session expired.", 401);
  }

  let sessionToken: string;
  try {
    const user = await verifyHandoffToken(token);
    sessionToken = await mintSessionToken(user);
  } catch {
    return errorPage("Session expired.", 401);
  }

  // Relative Location keeps the redirect on whatever host/proto the
  // browser used (TLS terminates at the Fly edge, so absolute URLs
  // built from the internal request would be http://). Redirecting
  // also drops the one-time token from the URL bar and history.
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: `${BASE_PATH}/` },
  });
  res.cookies.set(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS);
  return res;
}
