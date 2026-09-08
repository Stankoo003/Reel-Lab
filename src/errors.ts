/**
 * The message a user should see.
 *
 * `String(e)` renders "Error: Feed failed: …", leaking the class name into the UI — which is
 * what thirteen call sites were doing, in three different spellings.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Whether this is a request the app itself cancelled.
 *
 * A search that types a fourth letter aborts the request for the first three, and that
 * rejection reaches the same catch block as a real failure. Showing it would put a red error
 * on screen for the one thing that means everything is working — so callers that cancel have
 * to be able to tell the two apart.
 *
 * The name is what identifies it: `fetch` rejects with a DOMException named "AbortError",
 * and React Native's polyfill matches that. `instanceof DOMException` would not work — the
 * runtime does not expose that constructor.
 */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "CanceledError");
}
