import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// SSO handoff from EVQBet. EVQBet mints a 60-second HS256 JWT
// (aud "toteflow", iss "evqbet") signed with the shared
// TOTEFLOW_HANDOFF_SECRET; /auth/evqbet exchanges it for our own
// longer-lived session cookie. The session JWT uses distinct iss/aud
// values so neither token can be replayed as the other even though
// they share a signing secret.

export const SESSION_COOKIE = "toteflow_session";

const HANDOFF_ISSUER = "evqbet";
const HANDOFF_AUDIENCE = "toteflow";
const SESSION_ISSUER = "toteflow";
const SESSION_AUDIENCE = "toteflow-session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface EvqbetUser {
  userId: string;
  email: string;
  isPremium: boolean;
  isAdmin: boolean;
}

function secretKey(): Uint8Array | null {
  const secret = process.env.TOTEFLOW_HANDOFF_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export function handoffConfigured(): boolean {
  return secretKey() !== null;
}

export async function verifyHandoffToken(token: string): Promise<EvqbetUser> {
  const key = secretKey();
  if (!key) throw new Error("TOTEFLOW_HANDOFF_SECRET not configured");
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
    issuer: HANDOFF_ISSUER,
    audience: HANDOFF_AUDIENCE,
  });
  return {
    userId: String(payload.user_id ?? payload.sub ?? ""),
    email: String(payload.email ?? ""),
    isPremium: Boolean(payload.is_premium),
    isAdmin: Boolean(payload.is_admin),
  };
}

export async function mintSessionToken(user: EvqbetUser): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("TOTEFLOW_HANDOFF_SECRET not configured");
  return new SignJWT({
    email: user.email,
    is_premium: user.isPremium,
    is_admin: user.isAdmin,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // toteflow.evqbet.com and evqbet.com are same-site, so Lax works
  // inside the EVQBet iframe.
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

/**
 * Read and verify the EVQBet-derived session cookie. Returns null when
 * absent, invalid, expired, or when the handoff secret isn't configured.
 * Feature gates (e.g. premium-only views) can call this; nothing enforces
 * it globally today.
 */
export async function getSession(): Promise<EvqbetUser | null> {
  const key = secretKey();
  if (!key) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    return {
      userId: String(payload.sub ?? ""),
      email: String(payload.email ?? ""),
      isPremium: Boolean(payload.is_premium),
      isAdmin: Boolean(payload.is_admin),
    };
  } catch {
    return null;
  }
}
