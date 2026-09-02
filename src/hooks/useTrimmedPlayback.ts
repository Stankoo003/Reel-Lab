// Keep the editor's preview inside the trim selection.
//
// expo-video knows nothing about our in/out points: left alone it plays the whole
// source, so the preview disagreed with what Export would write. This watches
// `timeUpdate` and loops the playhead back to the in-point when it reaches the out-
// point. Looping rather than stopping, because the selection is something you watch
// several times while nudging a handle — and `player.loop` cannot express "loop this
// sub-range", it only repeats the whole file.
import { useCallback, useEffect, useRef } from "react";
import type { VideoPlayer } from "expo-video";

/** Seconds. timeUpdate fires every 0.1s, so the out-point can only be observed late. */
const EDGE = 0.05;
/** Ignore ticks for this long after a corrective seek: they still carry the old time. */
const SETTLE_MS = 250;

export function useTrimmedPlayback(
  player: VideoPlayer,
  start: number,
  end: number,
  /** Called whenever the hook moves the playhead, so the UI's position stays honest. */
  onSeek?: (time: number) => void
) {
  // Refs, not deps: the handles move continuously while dragging and re-subscribing
  // the native listener on every frame of a drag would be the jank we are avoiding.
  const range = useRef({ start, end });
  range.current = { start, end };
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const settleUntil = useRef(0);

  const seek = useCallback(
    (time: number) => {
      try {
        player.currentTime = time;
      } catch {
        return; // released
      }
      settleUntil.current = Date.now() + SETTLE_MS;
      onSeekRef.current?.(time);
    },
    [player]
  );

  useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      const { start, end } = range.current;
      if (Date.now() < settleUntil.current) return;
      let playing = false;
      try {
        playing = player.playing;
      } catch {
        return;
      }
      // Only correct during playback: a paused scrub outside the range is the
      // operator looking around, not something to fight.
      if (!playing) return;
      const t = currentTime ?? 0;
      if (t >= end - EDGE || t < start - EDGE) seek(start);
    });
    return () => sub.remove();
  }, [player, seek]);

  /** Play from inside the selection: rewinds first if the playhead sits outside it. */
  const playInRange = useCallback(() => {
    const { start, end } = range.current;
    let t = start;
    try {
      t = player.currentTime;
    } catch {
      return;
    }
    if (t < start || t >= end - EDGE) seek(start);
    player.play();
  }, [player, seek]);

  return { playInRange, seek };
}
