/**
 * Forgotten passwords. The stored row holds a hash; a token works once and a new request
 * retires the old ones; the request endpoint answers identically — body, status and TIME — for
 * a registered and an unregistered address; a completed reset invalidates every session.
 */
import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { sql } from "@/db/client";
import { config } from "@/lib/config";
import { TooManyRequestsError, ValidationError } from "@/lib/errors";
import { hashPassword, MIN_PASSWORD } from "@/lib/password";
import { tryAcquire } from "@/lib/rateLimit";
import { mailer } from "@/mail";
import type { UserRow } from "./dto";
import { findByEmail } from "./users";

export const REQUEST_ACCEPTED = "If that email has an account, a reset link is on its way.";
export const INVALID_TOKEN = "That reset link is no longer valid. Ask for a new one.";
export const EXPIRED_TOKEN = "That reset link has expired. Ask for a new one.";
export const RATE_LIMITED = "Too many reset requests. Wait a few minutes and try again.";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns nothing, throws only when rate limited. An unknown address is a non-event. */
export async function requestReset(email: string, clientIp: string): Promise<void> {
  const start = Date.now();
  try {
    const key = email.trim().toLowerCase();
    const { perEmailLimit, perIpLimit, windowMs } = config.passwordReset;
    // Both counters tick, so a flood cannot spend only the cheaper one.
    const byEmail = await tryAcquire(`reset:email:${key}`, perEmailLimit, windowMs);
    const byIp = await tryAcquire(`reset:ip:${clientIp}`, perIpLimit, windowMs);
    if (!byEmail || !byIp) throw new TooManyRequestsError(RATE_LIMITED);

    const user = await findByEmail(key);
    if (!user) return;

    const token = randomBytes(32).toString("base64url");
    await sql.begin(async (tx) => {
      await tx`update password_resets set consumed_at = now() where user_id = ${user.id}::uuid and consumed_at is null`;
      await tx`insert into password_resets (user_id, token_hash, expires_at, requested_ip)
               values (${user.id}::uuid, ${sha256(token)}, now() + make_interval(secs => ${config.passwordReset.ttlMs / 1000}), ${clientIp.slice(0, 45)})`;
    });
    // After the response: mail takes as long as mail takes, and that time must not reach the
    // caller. `after` keeps a serverless instance alive until the send has finished.
    const { email: to } = user;
    after(() => deliver(to, token));
  } finally {
    // The constant floor is what makes the registered and unregistered paths cost the same.
    const remaining = config.passwordReset.responseFloorMs - (Date.now() - start);
    if (remaining > 0) await sleep(remaining);
  }
}

export async function reset(token: string, newPassword: string): Promise<UserRow> {
  if (newPassword.length < MIN_PASSWORD) throw new ValidationError(`Use at least ${MIN_PASSWORD} characters.`);
  if (!token.trim()) throw new ValidationError(INVALID_TOKEN);

  const [row] = await sql<{ id: string; user_id: string; consumed_at: string | null; expired: boolean }[]>`
    select id, user_id, consumed_at, expires_at <= now() as expired
    from password_resets where token_hash = ${sha256(token)}`;
  if (!row || row.consumed_at) throw new ValidationError(INVALID_TOKEN);
  if (row.expired) throw new ValidationError(EXPIRED_TOKEN);

  const hash = await hashPassword(newPassword);
  return sql.begin(async (tx) => {
    const [user] = await tx<UserRow[]>`
      update users set password_hash = ${hash}, password_changed_at = now(), updated_at = now()
      where id = ${row.user_id}::uuid returning *`;
    await tx`update password_resets set consumed_at = now() where user_id = ${row.user_id}::uuid and consumed_at is null`;
    return user;
  });
}

async function deliver(to: string, token: string) {
  const link = `${config.mail.webBaseUrl}/reset?token=${token}`;
  const minutes = Math.round(config.passwordReset.ttlMs / 60_000);
  const text = `Someone asked to reset the password on your ReelLab account.

Open this link to choose a new one:
${link}

The link works once and expires in ${minutes} minutes. If this was not you, you can
ignore this email — nothing has changed, and your password still works.
`;
  const html = `<p>Someone asked to reset the password on your ReelLab account.</p>
<p><a href="${link}">Choose a new password</a></p>
<p>The link works once and expires in ${minutes} minutes. If this was not you, you can
ignore this email &mdash; nothing has changed, and your password still works.</p>
<p style="color:#666;font-size:12px">${link}</p>
`;
  try {
    await mailer().send(to, "Reset your ReelLab password", text, html);
  } catch (e) {
    console.error("Could not send a password reset email", e);
  }
}
