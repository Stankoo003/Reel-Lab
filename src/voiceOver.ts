// Recording a voice-over, and where the file lands.
//
// Takes go to Paths.document, not Paths.cache: a take is a performance that cannot be
// regenerated, and the OS is free to reclaim the cache directory whenever it wants the
// space. Same reasoning as recorded clips — see src/clips.ts.
import { Directory, File, Paths } from "expo-file-system";

/** Where takes live. One directory so a clean-up can find all of them. */
function voiceDir(): Directory {
  const dir = new Directory(Paths.document, "voice");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Move a finished recording out of the recorder's temporary location.
 *
 * expo-audio writes takes into the app's cache. Leaving one there means an export could
 * find the file gone between recording it and pressing Export.
 */
export function keepTake(uri: string): string {
  const src = new File(uri);
  const ext = (uri.split("?")[0].match(/\.(\w{2,4})$/)?.[1] ?? "m4a").toLowerCase();
  const dest = new File(voiceDir(), `take-${Date.now()}.${ext}`);
  src.copy(dest);
  return dest.uri;
}

/** Delete a take. Safe to call on a URI whose file is already gone. */
export function discardTake(uri: string | null): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // A take that cannot be deleted is not worth failing the edit over; the worst case is
    // an orphaned file the next clean-up finds.
  }
}

/**
 * The session switch, re-exported.
 *
 * It used to be defined here, which meant the camera — the app's other recorder — either
 * imported it from a module named after voice-over or, as it did, forgot it entirely and
 * failed to record at all. It belongs to the session, not to this feature.
 */
export { beginRecordingMode, endRecordingMode } from "./audioSession";
