// Auditioning a bundled music bed.
//
// Picking a bed by reading "Low pulse, 120 bpm" is picking blind. This plays the real file
// for a few seconds so the choice is made by ear, which is the only way a piece of music can
// honestly be chosen.
//
// A plain module rather than a hook: the timers and the player have to outlive any single
// render, and stopping playback must never be something that depends on a component still
// being mounted. React reads it through subscribe() below.
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { musicTrack } from "./assets";
import type { MusicTrackId } from "./types";

/**
 * How long an audition runs.
 *
 * Long enough to hear the loop's character — the shortest bed is 8s at 120 bpm, so five
 * seconds is ten bars of it — and short enough that you are never waiting for it to stop
 * before you can try the next one.
 */
export const PREVIEW_SECONDS = 5;

/** Length of the fade at the end. A hard cut on a sustained pad sounds like a fault. */
const FADE_MS = 400;
const FADE_STEPS = 8;

let player: AudioPlayer | null = null;
let current: MusicTrackId | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

/** Which track is auditioning, or null. Read by the UI through useSyncExternalStore. */
export function previewingTrack(): MusicTrackId | null {
  return current;
}

export function subscribeToPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

function clearTimers() {
  if (stopTimer) clearTimeout(stopTimer);
  if (fadeTimer) clearInterval(fadeTimer);
  stopTimer = null;
  fadeTimer = null;
}

/**
 * Stop whatever is auditioning, at once.
 *
 * Safe to call when nothing is playing, and safe to call twice — every path out of a preview
 * (a second tap, a different row, leaving the editor, starting an export) comes through here.
 */
export function stopPreview() {
  clearTimers();
  const dying = player;
  player = null;
  const was = current;
  current = null;
  try {
    dying?.pause();
    // The native player holds an audio session; dropping the reference is not releasing it.
    dying?.remove();
  } catch {
    // A player already released by a hot reload throws here. Nothing left to stop.
  }
  if (was) notify();
}

function fadeOutAndStop() {
  const fading = player;
  if (!fading) return stopPreview();

  let step = 0;
  const from = fading.volume;
  fadeTimer = setInterval(() => {
    step += 1;
    /*
     * The player was swapped out from under this interval — a tap on another row while this
     * one was fading. Just stop stepping: whatever replaced it has its own timers, and
     * clearing "the" timers here would cancel the new preview's stop, leaving a bed playing
     * forever. (stopPreview already cleared this interval on its way out, so reaching this
     * line at all means something unexpected happened.)
     */
    if (player !== fading) return;
    try {
      fading.volume = Math.max(0, from * (1 - step / FADE_STEPS));
    } catch {
      return stopPreview();
    }
    if (step >= FADE_STEPS) stopPreview();
  }, FADE_MS / FADE_STEPS);
}

/**
 * Play one bed for {@link PREVIEW_SECONDS}.
 *
 * Tapping the track that is already auditioning stops it — the same row is start and stop,
 * so there is never a preview running that you cannot see how to end.
 */
export function previewTrack(id: MusicTrackId) {
  if (current === id) {
    stopPreview();
    return;
  }
  // One audition at a time. Two beds at once is not a preview of either.
  stopPreview();

  try {
    const next = createAudioPlayer(musicTrack(id).mod);
    player = next;
    current = id;

    // The countdown starts when sound actually starts, not when play() is called: the file
    // has to be read off the bundle first, and starting the clock here would spend part of
    // the five seconds on silence.
    next.play();
    /*
     * The clock starts here rather than when the first sample actually sounds. The bed is a
     * small file already inside the app bundle, so the gap is a few tens of milliseconds —
     * and the alternative, waiting on a playbackStatusUpdate that says `playing`, buys back
     * that fraction at the cost of a preview that never ends if the status never arrives.
     * Every bed is at least 8s long, so the window always closes before the file does.
     */
    stopTimer = setTimeout(fadeOutAndStop, PREVIEW_SECONDS * 1000);
    notify();
  } catch {
    // No preview is a smaller failure than an editor that crashes when you tap a row.
    stopPreview();
  }
}
