/**
 * Postgres timestamp text ⇄ ISO-8601, without ever passing through a JS Date.
 *
 * The pool returns timestamptz as text in UTC ("2025-09-01 10:00:00.123456+00"). Responses
 * carry the Java Instant shape ("2025-09-01T10:00:00.123456Z") so nothing the client parses
 * changes. Precision is preserved in both directions.
 */

const PG = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}(?::?\d{2})?)?$/;

export function toIso(pg: string | null | undefined): string | null {
  if (pg == null) return null;
  const m = PG.exec(pg);
  if (!m) {
    // Already ISO, or something unexpected: fall back to the parser rather than lying.
    const d = new Date(pg);
    return Number.isNaN(d.getTime()) ? String(pg) : d.toISOString();
  }
  if (m[4] && m[4] !== "+00" && m[4] !== "+00:00" && m[4] !== "+0000") {
    // Not UTC — the session should always be, but do not silently mislabel a moment.
    return new Date(pg).toISOString();
  }
  return `${m[1]}T${m[2]}${m[3] ?? ""}Z`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

/** Epoch milliseconds of a Postgres or ISO timestamp, truncated like Java's toEpochMilli. */
export function toEpochMs(ts: string): number {
  const iso = toIso(ts);
  return Date.parse(iso ?? ts);
}

/** Validate an ISO instant the client sent, returning it in a form Postgres accepts. */
export function parseInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

export const EPOCH_ISO = "1970-01-01T00:00:00Z";

export function isEpoch(ts: string | null | undefined): boolean {
  return ts != null && toEpochMs(ts) === 0;
}
