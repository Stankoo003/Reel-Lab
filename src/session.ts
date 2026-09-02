// Who is signed in, and the token that proves it.
//
// Deliberately NOT a React context. Two of the modules that need the caller's identity —
// api/client.ts and src/library.ts — are plain modules that cannot call a hook, and they are
// the ones that talk to the server. So the truth lives here, in module state, and the React
// layer (src/state/AuthContext.tsx) subscribes to it rather than owning it.
//
// Kept in memory as well as in the keychain because every outgoing request reads the token,
// and SecureStore is asynchronous — an async read per request would either stall the request
// or race it.
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "reellab.token";
const USER_ID_KEY = "reellab.userId";

export type Session = { token: string; userId: string };

let current: Session | null = null;
let restored = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The token for the Authorization header, or null when signed out. */
export function getToken(): string | null {
  return current?.token ?? null;
}

/**
 * The signed-in user's id, or null.
 *
 * The server no longer accepts an id in a request, so this is only for the client's own
 * questions — "is this comment mine", "may I edit this clip". It is not what authorises
 * anything.
 */
export function currentUserId(): string | null {
  return current?.userId ?? null;
}

export function getSession(): Session | null {
  return current;
}

/** True once the keychain has been read, whether or not it held anything. */
export function isRestored(): boolean {
  return restored;
}

export async function setSession(session: Session): Promise<void> {
  current = session;
  restored = true;
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, session.token),
    SecureStore.setItemAsync(USER_ID_KEY, session.userId),
  ]);
  notify();
}

export async function clearSession(): Promise<void> {
  current = null;
  restored = true;
  // Cleared even if one of the two throws, so a partial failure cannot leave a token behind
  // that the app believes it has already forgotten.
  await Promise.allSettled([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
  ]);
  notify();
}

/**
 * Read the stored session back on launch.
 *
 * Only says what was on the device; whether the token is still VALID is a question only the
 * server can answer, which is what the /api/auth/me call in AuthContext is for.
 */
export async function restore(): Promise<Session | null> {
  try {
    const [token, userId] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_ID_KEY),
    ]);
    current = token && userId ? { token, userId } : null;
  } catch {
    // A keychain that cannot be read is the same situation as an empty one: signed out.
    // Failing here would leave the app stuck on its splash with nothing to say.
    current = null;
  }
  restored = true;
  notify();
  return current;
}

/** Returns the unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
