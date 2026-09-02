// Clip library backing the design's Clips screen. Everything here is real:
// duration and size come off the file, the poster frame from expo-video.
import { createVideoPlayer } from "expo-video";
import type { VideoPlayer } from "expo-video";
import { File, Paths } from "expo-file-system";
import { toPath } from "./assets";
import type { Clip, ClipOrigin, ClipThumb } from "./types";

export function mmss(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function timecode(seconds: number | null | undefined): string {
  const s = Math.max(0, seconds ?? 0);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const rest = (s % 60).toFixed(2).padStart(5, "0");
  return `${m}:${rest}`;
}

async function waitForDuration(player: VideoPlayer): Promise<number> {
  for (let i = 0; i < 50 && !player.duration; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return player.duration || 0;
}

let counter = 0;

/**
 * Adopt a clip into the library: copy it to cache under a stable name (FFmpeg wants
 * a plain absolute path, not a picker-owned temp URI), then read its real metadata.
 */
export async function adoptClip(uri: string, origin: ClipOrigin): Promise<Clip> {
  const ext = (uri.split("?")[0].match(/\.(\w{2,4})$/)?.[1] ?? "mp4").toLowerCase();
  const name = `clip_${String(++counter).padStart(2, "0")}`;
  const dest = new File(Paths.cache, `${name}.${ext}`);
  if (dest.exists) dest.delete();

  // A remote clip has to be materialised before it is usable: FFmpeg export takes a
  // bare filesystem path (see export.ts), and File.copy is a synchronous local copy
  // that cannot read an https:// URI.
  if (/^https?:\/\//i.test(uri)) {
    await File.downloadFileAsync(uri, dest);
  } else {
    new File(uri).copy(dest);
  }

  const player = createVideoPlayer(dest.uri);
  let duration = 0;
  let thumb: ClipThumb = null;
  try {
    duration = await waitForDuration(player);
    const shots = await player.generateThumbnailsAsync([Math.min(0.5, duration / 2)], { maxWidth: 400 });
    thumb = shots[0] ?? null;
  } catch {
    // a poster frame is nice-to-have; the clip is still usable without one
  } finally {
    player.release?.();
  }

  return {
    id: `${name}-${Date.now()}`,
    name,
    uri: dest.uri,
    path: toPath(dest.uri),
    origin,
    duration,
    durationLabel: mmss(duration),
    bytes: dest.size ?? 0,
    when: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    thumb,
  };
}

