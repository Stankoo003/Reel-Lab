/**
 * The position of the last row a client has seen: a timestamp and the id that breaks its ties.
 * Encoded as base64url without padding of "<iso instant>|<uuid>" — the same wire format the
 * Spring backend produced, so a cursor handed out by either is readable by this one.
 */
import { InvalidCursorError } from "./errors";
import { parseInstant, toIso } from "./time";

export type PageCursor = { createdAt: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(createdAt: string, id: string): string {
  const raw = `${toIso(createdAt)}|${id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** Null for an absent or blank cursor — a first page, not a broken one. */
export function decodeCursor(encoded: string | null | undefined): PageCursor | null {
  if (!encoded || !encoded.trim()) return null;
  let raw: string;
  try {
    raw = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    throw new InvalidCursorError();
  }
  const sep = raw.indexOf("|");
  if (sep < 0) throw new InvalidCursorError();
  const createdAt = parseInstant(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (!createdAt || !UUID.test(id)) throw new InvalidCursorError();
  return { createdAt, id: id.toLowerCase() };
}

/** The cursor pointing just past this page, or null when there is nothing after it. */
export function nextCursor<T extends { createdAt: string; id: string }>(rows: T[], hasNext: boolean): string | null {
  if (!hasNext || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return encodeCursor(last.createdAt, last.id);
}
