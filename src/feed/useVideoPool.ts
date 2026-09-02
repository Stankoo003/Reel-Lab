// A fixed pool of video players, reused across the feed.
//
// One VideoPlayer per row does not survive a real feed: each holds a decoder and its
// own buffers, so a few dozen rows exhausts memory and the scroll stutters. Instead
// three players are created once and `replace()`d as the active index moves.
//
// The neighbours are loaded but paused, which is what gives preloading for free — the
// next clip has already buffered by the time the user swipes to it.
import { useCallback, useEffect, useRef, useState } from "react";
import { createVideoPlayer } from "expo-video";
import type { VideoPlayer } from "expo-video";
import type { Clip } from "../types";

const POOL_SIZE = 3; // previous, current, next

export type VideoPool = {
  /** The player assigned to a row, or null if the row is outside the window. */
  playerFor: (index: number) => VideoPlayer | null;
  pauseAll: () => void;
};

/** What a pooled player is currently loaded with, so a stale slot can be recognised. */
type Slot = { player: VideoPlayer; clipId: string };

export function useVideoPool({
  items,
  activeIndex,
  enabled,
  paused,
  muted,
}: {
  items: Clip[];
  activeIndex: number;
  /** False pauses the pool — the tab lost focus, or the app went to the background. */
  enabled: boolean;
  /**
   * The viewer tapped to pause. Kept apart from `enabled` on purpose: `enabled` is the
   * system's opinion and comes back on its own, this is the viewer's and must not.
   */
  paused: boolean;
  /** The viewer muted the feed. Sticks across clips — a mute is about the feed, not a clip. */
  muted: boolean;
}): VideoPool {
  const poolRef = useRef<VideoPlayer[] | null>(null);
  // index -> slot, so a row can ask "is there a player for me?"
  const [assignment, setAssignment] = useState<Map<number, Slot>>(() => new Map());
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;

  // Create the players once.
  if (poolRef.current === null) {
    poolRef.current = Array.from({ length: POOL_SIZE }, () => {
      const p = createVideoPlayer(null);
      p.loop = true;
      p.muted = true; // unmuted only when it becomes the active player
      p.bufferOptions = { preferredForwardBufferDuration: 5 };
      // Defaults to 0, which means the timeUpdate event never fires. Four ticks a second
      // is enough for a progress bar to look continuous without waking JS every frame.
      p.timeUpdateEventInterval = 0.25;
      return p;
    });
  }

  useEffect(() => {
    const players = poolRef.current!;
    return () => {
      players.forEach((p) => {
        try {
          p.pause();
          p.release?.();
        } catch {
          // already torn down
        }
      });
    };
  }, []);

  // Reassign players whenever the window moves.
  useEffect(() => {
    const players = poolRef.current!;
    if (!items.length) {
      // Returning early here left the previous assignment in place, so after a refresh that
      // came back empty the active player kept playing audio over an empty screen.
      players.forEach((p) => {
        try {
          p.pause();
        } catch {
          // already torn down
        }
      });
      if (assignmentRef.current.size > 0) setAssignment(new Map());
      return;
    }
    const wanted = [activeIndex - 1, activeIndex, activeIndex + 1].filter(
      (i) => i >= 0 && i < items.length
    );

    const next = new Map<number, Slot>();

    // Keep a slot only if it is still on a wanted index AND still holds that row's clip.
    // Matching on the index alone is not enough: after a refresh, index 0 is a different
    // clip, and the old one would keep playing under the new row's title.
    for (const [index, slot] of assignmentRef.current) {
      if (wanted.includes(index) && items[index]?.id === slot.clipId) next.set(index, slot);
    }

    const kept = [...next.values()].map((slot) => slot.player);
    const free = players.filter((player) => !kept.includes(player));

    let changed = next.size !== assignmentRef.current.size;
    for (const index of wanted) {
      if (next.has(index)) continue;
      const player = free.shift();
      if (!player) continue;
      try {
        player.replace({ uri: items[index].uri });
        player.currentTime = 0;
      } catch {
        // a source that fails to load leaves the row on its poster
      }
      next.set(index, { player, clipId: items[index].id });
      changed = true;
    }

    if (changed) setAssignment(next);
  }, [items, activeIndex]);

  // Only the active player runs, and only it is audible.
  //
  // This effect is also the interruption recovery path: a call or another app takes audio
  // focus and the OS pauses the player behind our back, but nothing here changed, so the
  // moment `enabled` comes back true on returning to the app it is re-asserted and the
  // clip resumes — unless the viewer had paused it, which `paused` remembers.
  useEffect(() => {
    for (const [index, { player }] of assignment) {
      const isActive = index === activeIndex;
      try {
        // Only the active clip is audible; neighbours are preloaded in silence.
        player.muted = !isActive || muted;
        if (isActive && enabled && !paused) player.play();
        else player.pause();
      } catch {
        // player torn down mid-update
      }
    }
  }, [assignment, activeIndex, enabled, paused, muted]);

  const playerFor = useCallback(
    (index: number) => assignment.get(index)?.player ?? null,
    [assignment]
  );

  const pauseAll = useCallback(() => {
    poolRef.current!.forEach((p) => {
      try {
        p.pause();
      } catch {
        // ignore
      }
    });
  }, []);

  return { playerFor, pauseAll };
}
