/**
 * Stored media paths are relative, never URLs — the CDN base is configuration and must not be
 * baked into rows. This is the one definition of "a path this system is willing to store" and
 * of how it becomes a URL on the way out.
 */
import { config } from "./config";
import { ValidationError } from "./errors";

const ABSOLUTE_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function requireRelative(field: string, path: string | null | undefined): void {
  if (path == null) return;
  if (ABSOLUTE_URI.test(path) || path.startsWith("/")) {
    throw new ValidationError(`${field} must be a relative path; the CDN base comes from configuration`);
  }
  for (const segment of path.split("/")) {
    if (segment === "..") throw new ValidationError(`${field} must not contain '..' path segments`);
  }
}

/** Relative path in, absolute URL out; null for nothing. */
export function mediaUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath || !relativePath.trim()) return null;
  return `${config.media.cdnBaseUrl}/${relativePath}`;
}
