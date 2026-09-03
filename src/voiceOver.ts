// Recording a voice-over, and where the file lands.
//
// Takes go to Paths.document, not Paths.cache: a take is a performance that cannot be
// regenerated, and the OS is free to reclaim the cache directory whenever it wants the
// space. Same reasoning as recorded clips — see src/clips.ts.
import { Directory, File, Paths } from "expo-file-system";
import { setAudioModeAsync } from "expo-audio";

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
 * iOS refuses to record while the session is configured for playback, and leaves the
 * session in recording mode afterwards — which makes subsequent playback quiet and routed
 * to the earpiece. So the mode is set on the way in AND restored on the way out.
 *
 * The restore values mirror app/_layout.tsx, which sets the app's normal playback policy.
 */
export async function beginRecordingMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

export async function endRecordingMode(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: "doNotMix",
  });
}
