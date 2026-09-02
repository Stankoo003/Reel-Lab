// Is this player actually playing, as reactive state.
//
// Reading `player.playing` in render is a snapshot: pressing Play mutates the native
// player without re-rendering the component, so the button label kept saying "PLAY"
// over a running video, and a non-looping clip that finished stayed on "PAUSE".
// Subscribing to `playingChange` is what keeps the label honest — including when the
// OS pauses playback behind our back.
import { useEffect, useState } from "react";
import type { VideoPlayer } from "expo-video";

export function usePlayerPlaying(player: VideoPlayer): boolean {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    try {
      setPlaying(player.playing);
    } catch {
      return; // released between render and effect
    }
    const sub = player.addListener("playingChange", ({ isPlaying }) => setPlaying(isPlaying));
    return () => sub.remove();
  }, [player]);

  return playing;
}
