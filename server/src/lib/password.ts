import bcrypt from "bcryptjs";

/** Mirrors the client's rule in src/auth.ts. The server is the one that decides. */
export const MIN_PASSWORD = 8;

/**
 * A hash that never matches, verified against when no account exists — so a missing account
 * and a wrong password cost the same time to answer.
 */
const DUMMY_HASH = "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";

export async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, 10);
}

/**
 * bcryptjs understands $2a$ and $2b$; the dev seed and PHP-style tools write $2y$, which is the
 * same algorithm under another prefix.
 */
export async function verifyPassword(raw: string, hash: string | null): Promise<boolean> {
  const normalised = (hash ?? DUMMY_HASH).replace(/^\$2y\$/, "$2b$");
  try {
    const ok = await bcrypt.compare(raw, normalised);
    return ok && hash != null;
  } catch {
    return false;
  }
}
