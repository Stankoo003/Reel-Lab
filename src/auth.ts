// Credential rules for the sign-in screens.
//
// A hint, not a decision. The server holds the real rules — AuthService rejects a short
// password and the unique indexes reject a taken email — and it is the one that answers.
// These exist so the form can say what is wrong without a round trip, and so nothing here
// can loosen what the server enforces: every rule below is the same as, or stricter than,
// its counterpart on the other side.

export const MIN_PASSWORD = 8;

/**
 * Deliberately loose. The only address that matters is one that can receive mail, and no
 * regex settles that — the confirmation message does. This rejects what is plainly not an
 * address and lets everything else through rather than turning away valid but unusual ones.
 */
export function emailError(email: string): string | undefined {
  const value = email.trim();
  if (!value) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "That does not look like an email address.";
  return undefined;
}

/**
 * The handle. Mirrors the `users.username` column: non-blank, at most 50 characters.
 *
 * The character restriction is this app's, not the database's — the handle appears in a
 * URL (`/@marko`), and a space or a slash in one would produce a link that does not work.
 */
export function usernameError(username: string): string | undefined {
  const value = username.trim();
  if (!value) return "Choose a username.";
  if (value.length > 50) return "That is too long — 50 characters at most.";
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    return "Letters, numbers, dots, dashes and underscores only.";
  }
  return undefined;
}

export function passwordError(password: string): string | undefined {
  if (!password) return "Enter a password.";
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return undefined;
}

/** Signup only — the second field exists to catch a typo in the first. */
export function confirmError(password: string, confirm: string): string | undefined {
  if (!confirm) return "Repeat your password.";
  if (confirm !== password) return "The two passwords do not match.";
  return undefined;
}
