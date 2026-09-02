// Filmstrip frames for the editor's timeline, extracted without blocking the UI.
//
// The old inline version asked expo-video for all ten thumbnails in one call and
// swallowed every failure ("filmstrip is a nicety"), which meant: nothing on screen
// for the whole extraction, an empty strip and no explanation when it failed, and a
// silent no-op whenever the effect ran before the player had loaded the source —
// `generateThumbnailsAsync` rejects while the status is still `loading`.
//
// This asks for one frame at a time. Each native call is async and does its decoding
// off the JS thread, so the JS thread stays free between frames; the strip fills in
// left to right and the caller gets a real 0…1 progress value to show.
import { useEffect, useState } from "react";
import type { VideoPlayer, VideoThumbnail } from "expo-video";

export type Filmstrip = {
  /** Fixed length `count`; a slot is null until its frame arrives. */
  frames: (VideoThumbnail | null)[];
  /** Frames delivered so far. */
  done: number;
  count: number;
  /** 0…1, for a progress bar. */
  progress: number;
  extracting: boolean;
  /** Set only when every frame failed — the editor still works without the strip. */
  error: string | null;
};

const empty = (count: number) => Array.from({ length: count }, () => null);

/**
 * @param duration Clip length in seconds. 0 means "not known yet" and the hook waits.
 */
export function useFilmstrip(player: VideoPlayer, duration: number, count = 10): Filmstrip {
  const [frames, setFrames] = useState<(VideoThumbnail | null)[]>(() => empty(count));
  const [done, setDone] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Wait for the source: thumbnails cannot be generated while the player is loading.
  useEffect(() => {
    setReady(false);
    try {
      if (player.status === "readyToPlay") setReady(true);
    } catch {
      return; // released between render and effect
    }
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") setReady(true);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (!ready || duration <= 0) return;
    let alive = true;
    setFrames(empty(count));
    setDone(0);
    setError(null);
    setExtracting(true);

    (async () => {
      let failures = 0;
      for (let i = 0; i < count; i++) {
        if (!alive) return;
        // Sample the middle of each cell, so the strip reads as "this slice of the
        // clip" rather than starting on the first frame and ending 1/10th early.
        const at = (duration * (i + 0.5)) / count;
        try {
          const [shot] = await player.generateThumbnailsAsync([at], { maxWidth: 120 });
          if (!alive) return;
          if (shot) {
            setFrames((prev) => {
              const next = prev.slice();
              next[i] = shot;
              return next;
            });
          } else {
            failures++;
          }
        } catch {
          failures++;
        }
        if (!alive) return;
        setDone(i + 1);
      }
      if (!alive) return;
      setExtracting(false);
      if (failures === count) setError("frames unavailable");
    })();

    return () => {
      alive = false;
      setExtracting(false);
    };
  }, [player, duration, count, ready]);

  return {
    frames,
    done,
    count,
    progress: count ? done / count : 0,
    extracting,
    error,
  };
}
