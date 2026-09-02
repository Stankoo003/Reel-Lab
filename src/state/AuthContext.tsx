// The React view of the session.
//
// It does not OWN the session — src/session.ts does, because api/client.ts and
// src/library.ts need the token and cannot call a hook. This subscribes to that module and
// turns it into state a screen can render, which keeps one source of truth instead of two
// that have to agree.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchMe, signIn as signInRequest, signUp as signUpRequest } from "../../api/client";
import { clearSession, currentUserId, restore, setSession, subscribe } from "../session";
import type { UserResponse } from "../../api/client";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

export type AuthValue = {
  status: AuthStatus;
  /** Null unless status is "signedIn". */
  user: UserResponse | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserResponse | null>(null);

  // Keeps this in step with a sign-out triggered from outside React — there is none today,
  // but the session module is what the non-React callers hold, and a screen showing a user
  // the token no longer belongs to would be the bug this prevents.
  useEffect(() => subscribe(() => {
    if (!currentUserId()) {
      setUser(null);
      setStatus("signedOut");
    }
  }), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await restore();
      if (!stored) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      try {
        // The keychain says there is a token; only the server can say it is still good.
        const me = await fetchMe();
        if (cancelled) return;
        setUser(me);
        setStatus("signedIn");
      } catch {
        // Expired, or signed with a secret the server has since rotated. Either way this is
        // not a session, and keeping it would fail every request from here on.
        await clearSession();
        if (!cancelled) setStatus("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback(async (result: { token: string; user: UserResponse }) => {
    // Stored before the state flips: the gate re-renders on `status`, and a screen that
    // mounted and fired a request before the token was written would send it without one.
    await setSession({ token: result.token, userId: String(result.user.id) });
    setUser(result.user);
    setStatus("signedIn");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => adopt(await signInRequest(email, password)),
    [adopt]
  );

  const signUp = useCallback(
    async (username: string, email: string, password: string) =>
      adopt(await signUpRequest(username, email, password)),
    [adopt]
  );

  const signOut = useCallback(async () => {
    await clearSession();
    setUser(null);
    setStatus("signedOut");
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/**
 * The signed-in user's id, for the "is this mine" checks screens make.
 *
 * Returns null while loading or signed out, so a comparison against it is false rather than
 * accidentally true.
 */
export function useCurrentUserId(): string | null {
  const { user } = useAuth();
  return user?.id ?? null;
}
