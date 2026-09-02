/**
 * The message a user should see.
 *
 * `String(e)` renders "Error: Feed failed: …", leaking the class name into the UI — which is
 * what thirteen call sites were doing, in three different spellings.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
