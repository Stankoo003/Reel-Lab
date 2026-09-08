/**
 * Bearer tokens: HS256 JWTs with the same claims the Spring backend issued, signed with the
 * same JWT_SECRET, so a session minted by either server is valid on this one.
 *
 *   iss = "reellab", sub = user id, iat, exp = iat + ttl,
 *   pwd = the account's password_changed_at in epoch millis.
 *
 * `pwd` is compared for EQUALITY against the stored value on every authenticated request. That
 * is what makes "changing the password signs out every device" true for stateless sessions,
 * and it costs one primary-key read per request.
 */
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { sql } from "@/db/client";
import { config } from "./config";
import { UnauthorizedError, SIGN_IN } from "./errors";
import { toEpochMs } from "./time";

const ISSUER = "reellab";
export const STALE = "Signed out because the password changed. Sign in again.";

function key(): Uint8Array {
  return new TextEncoder().encode(config.auth.secret);
}

export async function signToken(userId: string, passwordChangedAt: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ pwd: toEpochMs(passwordChangedAt) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + Math.floor(config.auth.ttlMs / 1000))
    .setSubject(userId)
    .sign(key());
}

export type Principal = { userId: string };

/**
 * The user the request's token belongs to, or null when there is no Authorization header.
 * A header that is present but not a valid live token is a 401, never "anonymous": a client
 * that thinks it is signed in has to learn otherwise.
 */
export async function optionalUser(req: Request): Promise<Principal | null> {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) throw new UnauthorizedError(SIGN_IN);

  let sub: string | undefined;
  let pwd: unknown;
  try {
    const { payload } = await jwtVerify(m[1], key(), { issuer: ISSUER, algorithms: ["HS256"] });
    sub = payload.sub;
    pwd = payload.pwd;
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw new UnauthorizedError("Your session has expired. Sign in again.");
    throw new UnauthorizedError(SIGN_IN);
  }
  if (typeof pwd !== "number" || !sub) throw new UnauthorizedError(STALE);

  const rows = await sql<{ password_changed_at: string }[]>`
    select password_changed_at from users where id = ${sub}::uuid`;
  const user = rows[0];
  if (!user || toEpochMs(user.password_changed_at) !== pwd) throw new UnauthorizedError(STALE);
  return { userId: sub };
}

export async function requireUser(req: Request): Promise<Principal> {
  const principal = await optionalUser(req);
  if (!principal) throw new UnauthorizedError(SIGN_IN);
  return principal;
}
