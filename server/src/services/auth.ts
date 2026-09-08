import { sql } from "@/db/client";
import { ConflictError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { hashPassword, MIN_PASSWORD, verifyPassword } from "@/lib/password";
import type { UserRow } from "./dto";
import { EMAIL_TAKEN, findByEmail, requireUserRow, USERNAME_TAKEN } from "./users";

/** One message for "no such email" and "wrong password" — telling them apart enumerates accounts. */
export const BAD_CREDENTIALS = "That email and password do not match.";
export const WRONG_CURRENT_PASSWORD = "That is not your current password.";
export const SAME_PASSWORD = "Choose a password you have not used just now.";

export async function signup(username: string, email: string, displayName: string, rawPassword: string): Promise<UserRow> {
  if (rawPassword.length < MIN_PASSWORD) throw new ValidationError(`Use at least ${MIN_PASSWORD} characters.`);
  const [taken] = await sql<{ username: boolean; email: boolean }[]>`
    select exists (select 1 from users where lower(username) = lower(${username})) as username,
           exists (select 1 from users where lower(email) = lower(${email})) as email`;
  if (taken.username) throw new ConflictError(USERNAME_TAKEN);
  if (taken.email) throw new ConflictError(EMAIL_TAKEN);
  const hash = await hashPassword(rawPassword);
  // The unique indexes are the guarantee; a lost race surfaces as 23505 and becomes the same 409.
  const [row] = await sql<UserRow[]>`
    insert into users (username, email, display_name, password_hash)
    values (${username}, ${email}, ${displayName}, ${hash})
    returning *`;
  return row;
}

export async function authenticate(email: string, rawPassword: string): Promise<UserRow> {
  const user = await findByEmail(email);
  // Verified even when no user was found, so both failures take the same time to answer.
  const matches = await verifyPassword(rawPassword, user?.password_hash ?? null);
  if (!user || !matches) throw new UnauthorizedError(BAD_CREDENTIALS);
  return user;
}

/** Requires the current password even with a valid token, and retires every token minted before. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<UserRow> {
  const user = await requireUserRow(userId).catch(() => { throw new UnauthorizedError(BAD_CREDENTIALS); });
  if (!(await verifyPassword(currentPassword, user.password_hash))) throw new UnauthorizedError(WRONG_CURRENT_PASSWORD);
  if (newPassword.length < MIN_PASSWORD) throw new ValidationError(`Use at least ${MIN_PASSWORD} characters.`);
  if (newPassword === currentPassword) throw new ValidationError(SAME_PASSWORD);
  const hash = await hashPassword(newPassword);
  const [row] = await sql<UserRow[]>`
    update users set password_hash = ${hash}, password_changed_at = now(), updated_at = now()
    where id = ${userId}::uuid returning *`;
  return row;
}
