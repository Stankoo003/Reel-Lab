/**
 * Runtime configuration, per environment.
 *
 * Expo loads .env, .env.local, .env.development and .env.production automatically and
 * inlines EXPO_PUBLIC_* at build time — so these MUST be read with static dot notation.
 * process.env["EXPO_PUBLIC_…"] or destructuring will not be replaced.
 *
 * Nothing here is a secret. Anything secret must never carry the EXPO_PUBLIC_ prefix,
 * because the value ends up in plain text inside the shipped bundle.
 */

/** ReelLab API. localhost only resolves on the iOS simulator — use the LAN IP on a device. */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

/** Media CDN. Mirrors MEDIA_CDN_BASE_URL on the server. */
export const MEDIA_BASE_URL: string =
  process.env.EXPO_PUBLIC_MEDIA_BASE_URL ?? "http://localhost:8080/media";


/** Which env file was picked up, for display on the profile screen. */
export const APP_ENV: string = process.env.EXPO_PUBLIC_APP_ENV ?? "development";

/** Join the media base with a relative path, tolerating slashes on either side. */
export function mediaUrl(relativePath?: string | null): string | null {
  if (!relativePath) return null;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${MEDIA_BASE_URL.replace(/\/$/, "")}/${relativePath.replace(/^\//, "")}`;
}
