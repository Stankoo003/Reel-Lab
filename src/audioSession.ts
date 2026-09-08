// The one audio session, and the two states it is ever in.
//
// An AVAudioSession is process-wide, so this cannot be a per-screen setting — two screens
// with opinions would be overwriting each other. There are exactly two configurations the
// app ever wants, and they are here rather than duplicated at each call site: the playback
// policy that app/_layout.tsx installs at startup, and the recording one that anything
// capturing the microphone has to switch into and back out of.
import { setAudioModeAsync } from "expo-audio";

/**
 * The app's normal state: playing the feed.
 *
 * See app/_layout.tsx for why each value is what it is — silent-switch behaviour, no
 * background playback, and exclusive focus so the feed does not play over someone's music.
 */
export const PLAYBACK_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  interruptionMode: "doNotMix",
} as const;

/**
 * Switch the session to recording, and back.
 *
 * iOS refuses to capture the microphone while the session is configured for playback —
 * `allowsRecording` is what moves the category to `.playAndRecord`, and without it a
 * recording attempt fails rather than recording silence. It has to be switched BACK
 * afterwards: `.playAndRecord` routes output to the earpiece, so a session left in it makes
 * every clip afterwards sound broken and quiet.
 *
 * Both the camera and the editor's voice-over go through here, because a session left in
 * the wrong state by one of them is a bug that surfaces in the other.
 */
export async function beginRecordingMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

export async function endRecordingMode(): Promise<void> {
  await setAudioModeAsync({ ...PLAYBACK_MODE });
}
