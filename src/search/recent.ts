// The people you have already looked up.
//
// A search box that opens empty every time makes you retype the same handle every time. The
// list under it is the fix, and it is the only part of Search that survives closing the app.
//
// What gets remembered is a person you OPENED, not a string you typed. "mil", "mila", "mi"
// are three rows for one person and none of them is a thing you can tap; a row that carries
// the account is one tap back to where you were going.
import { Directory, File, Paths } from "expo-file-system";
import type { UserSummary } from "../../api/client";

/**
 * How many are kept.
 *
 * Long enough to hold the handful of people anyone actually goes back to, short enough that
 * it stays a shortcut rather than a second feed you have to scroll.
 */
const MAX = 12;

/**
 * Stored in the app's document directory, not the keychain: this is a convenience, not a
 * credential, and it is written on every profile you open — SecureStore is for the token.
 *
 * The file is per-user. Search history says who you were curious about, so handing the
 * previous account's to whoever signs in next on the same phone would be a small betrayal
 * with no upside.
 */
function fileFor(userId: string): File {
  const dir = new Directory(Paths.document, "search");
  dir.create({ intermediates: true, idempotent: true });
  // Ids are UUIDs from the server, but this builds a filesystem path, so anything that is
  // not a plain id character is dropped rather than trusted to be one.
  return new File(dir, `recent-${userId.replace(/[^a-zA-Z0-9-]/g, "")}.json`);
}

/**
 * Shaped, not merely parsed.
 *
 * The file is written by an older version of this app as often as by the current one, and a
 * row missing an id would render an unkeyed, untappable entry. Anything that does not look
 * like a person is dropped rather than trusted.
 */
function parse(text: string): UserSummary[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is UserSummary =>
      !!x && typeof x === "object" && typeof (x as UserSummary).id === "string")
    .slice(0, MAX);
}

/** The list, newest first. Empty whenever anything at all is wrong with the file. */
export function loadRecent(userId: string | null): UserSummary[] {
  if (!userId) return [];
  try {
    const file = fileFor(userId);
    if (!file.exists) return [];
    // textSync, not text(): the file is a few hundred bytes and every caller here is
    // synchronous — an async read would make loading the list a render-after-paint.
    return parse(file.textSync());
  } catch {
    // A corrupt or unreadable history is not worth an error on screen — the search box
    // above it still works, which is the part that matters.
    return [];
  }
}

/**
 * Move someone to the top of the list, and return the new list.
 *
 * Returned rather than only written so the caller can render it without reading the file
 * back — and so the screen updates in the same frame as the tap.
 *
 * The stored copy is refreshed on every visit, so a display name or avatar that changed
 * since last time is corrected the next time you open that profile rather than being
 * remembered wrong forever.
 */
export function rememberUser(userId: string | null, user: UserSummary): UserSummary[] {
  const next = [user, ...loadRecent(userId).filter((u) => u.id !== user.id)].slice(0, MAX);
  save(userId, next);
  return next;
}

/** Drop one row — the ✕ on it. */
export function forgetUser(userId: string | null, id: string): UserSummary[] {
  const next = loadRecent(userId).filter((u) => u.id !== id);
  save(userId, next);
  return next;
}

/** Drop all of them — "Clear". */
export function clearRecent(userId: string | null): UserSummary[] {
  save(userId, []);
  return [];
}

function save(userId: string | null, list: UserSummary[]) {
  if (!userId) return;
  try {
    const file = fileFor(userId);
    // `write` on a File that does not exist yet creates it; create() first would throw on
    // the second call.
    file.write(JSON.stringify(list));
  } catch {
    // Losing the history is survivable; failing the tap that was trying to open a profile
    // is not. This is called from the navigation path.
  }
}
