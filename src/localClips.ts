// The device-only side of the library.
//
// A clip that was recorded or imported on this device has never been uploaded: there is
// no server row, so no likes, no comments, nobody else who could ever see it. `library.ts`
// already names that distinction (`isServerBacked`); this module is what the profile's
// DRAFTS section uses to *say* it out loud and to remove such a clip for good.
import { File } from "expo-file-system";
import { isServerBacked } from "./library";
import type { Clip } from "./types";

/**
 * Does this clip exist only on this device?
 *
 * The exact complement of `isServerBacked`, written out so call sites read as the thing
 * they mean ("this is local-only") rather than as a negated server predicate.
 */
export function isLocalOnly(clip: Clip): boolean {
  return !isServerBacked(clip);
}

/** `1.2 GB`, `840 MB`, `12 KB`, `0 KB` — the units design 1b writes in its header. */
export function formatBytes(bytes: number | null | undefined): string {
  const b = Math.max(0, Math.trunc(bytes ?? 0));
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}

/**
 * What the local clips are costing in storage — design 1b's "4 clips · 1.2 GB local".
 *
 * `bytes` is what `adoptClip` measured when the file was copied in, so it is the size of
 * the app's own copy rather than of the original the picker handed over.
 */
export function localFootprint(clips: Clip[]): { count: number; bytes: number; label: string } {
  const local = clips.filter(isLocalOnly);
  const bytes = local.reduce((sum, c) => sum + (c.bytes || 0), 0);
  return {
    count: local.length,
    bytes,
    label: `${local.length} ${local.length === 1 ? "clip" : "clips"} · ${formatBytes(bytes)} on device`,
  };
}

/**
 * Delete the clip's file from app-private storage.
 *
 * Dropping the clip out of the in-memory list is not deleting it — the copy `adoptClip`
 * made in the app's cache directory would stay on disk, invisible and unreclaimable from
 * inside the app. This is what actually frees it.
 *
 * Only ever called for a local-only clip: a server-backed one's `uri` is a CDN URL, and
 * there is nothing on this device to remove. Returns false when there was no file to
 * delete or the platform refused, so the caller can still drop the list entry — a clip
 * whose file is already gone must not be stuck in the list forever.
 */
export function deleteLocalClipFile(clip: Clip): boolean {
  if (!isLocalOnly(clip)) return false;
  // `path` is the FFmpeg-friendly bare path; `uri` is the file:// form. `new File` wants
  // a URI, so prefer that and fall back to the path only if the URI is missing.
  const target = clip.uri || (clip.path ? `file://${clip.path}` : "");
  if (!target || !target.startsWith("file://")) return false;
  try {
    const file = new File(target);
    if (!file.exists) return false;
    file.delete();
    return true;
  } catch {
    // A file that cannot be deleted (already gone, or held open by a released player that
    // has not finished tearing down) must not block removing the entry.
    return false;
  }
}
