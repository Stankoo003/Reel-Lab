// The public link to a profile.
//
// PLACEHOLDER. There is no web app and no public profile page — nothing serves `/@name`
// today, so a scanned code lands on a 404. The shape is the part that is real: a handle URL
// is what this link will be, so the QR screen, the share sheet and anything built on top of
// them do not change when the page exists.
//
// The host is the API's, not `localhost`. A code is scanned by a SECOND device, where
// `localhost` means that device itself — the one place the link can never resolve. The API
// host is at least reachable from the same network, which makes the placeholder testable.
import { API_BASE_URL } from "../api/config";

/** Strips any trailing slash so the join below cannot produce `//@name`. */
const WEB_BASE = API_BASE_URL.replace(/\/+$/, "");

export function profileShareUrl(username?: string | null): string {
  // A profile with no handle still needs a link the share sheet can carry, and "unknown"
  // is visibly a placeholder rather than a plausible-looking wrong address.
  return `${WEB_BASE}/@${username?.trim() || "unknown"}`;
}
