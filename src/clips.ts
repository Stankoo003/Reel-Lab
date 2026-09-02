// Clip library backing the design's Clips screen. Everything here is real:
// duration and size come off the file, the poster frame from expo-video.
import { createVideoPlayer } from "expo-video";
import type { VideoPlayer } from "expo-video";
import { Directory, File, Paths } from "expo-file-system";
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

/**
 * Where captured and imported clips live: `<app sandbox>/Documents/clips`.
 *
 * `Paths.document`, deliberately NOT `Paths.cache`. The cache directory is reclaimable —
 * the OS is free to delete anything in it when the device runs low on storage, and on iOS
 * it is also excluded from backup — so a recording parked there can vanish between two
 * launches, before the user ever exported it. `Paths.document` is app-private on both
 * platforms (iOS `<app>/Documents`, Android `/data/data/<pkg>/files`), unreachable by other
 * apps, and never reclaimed, so a clip is still there after a restart.
 *
 * Cache is still the right home for two other things, and they stay there: the bundled
 * spike assets and FFmpeg's output (`src/assets.ts`), which are regenerated on demand, and
 * a remote library clip pulled down for export (`materialiseForExport` in `src/library.ts`),
 * which can always be downloaded again from the CDN.
 *
 * Nothing here leaves the device. Uploads happen only from the publish flow (`app/post.tsx`
 * → `uploadMedia`), against an exported file the user explicitly chose to publish.
 */
function clipsDir(): Directory {
  const dir = new Directory(Paths.document, "clips");
  // idempotent so a second call is a no-op rather than a throw.
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Stored clips are named `<origin>-<capturedAtMs>-<n>.<ext>`.
 *
 * The filename is the only place a restored clip's provenance and capture time survive —
 * there is no database in the spike — so both are encoded in it rather than being guessed
 * from filesystem metadata.
 */
const STORED = /^(camera|gallery|library)-(\d+)-(\d+)\.(\w{2,4})$/;

function extensionOf(uri: string): string {
  return (uri.split("?")[0].match(/\.(\w{2,4})$/)?.[1] ?? "mp4").toLowerCase();
}

async function waitForDuration(player: VideoPlayer): Promise<number> {
  for (let i = 0; i < 50 && !player.duration; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return player.duration || 0;
}

let counter = 0;

/** Read a stored file's real metadata and build the Clip the editor and the feed use. */
async function describe(
  file: File,
  origin: ClipOrigin,
  name: string,
  capturedAt: number
): Promise<Clip> {
  const player = createVideoPlayer(file.uri);
  let duration = 0;
  let thumb: ClipThumb = null;
  try {
    duration = await waitForDuration(player);
    const shots = await player.generateThumbnailsAsync([Math.min(0.5, duration / 2)], {
      maxWidth: 400,
    });
    thumb = shots[0] ?? null;
  } catch {
    // a poster frame is nice-to-have; the clip is still usable without one
  } finally {
    player.release?.();
  }

  return {
    id: `${file.name}-${capturedAt}`,
    name,
    uri: file.uri,
    path: toPath(file.uri),
    origin,
    duration,
    durationLabel: mmss(duration),
    bytes: file.size ?? 0,
    when: new Date(capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    thumb,
  };
}

/**
 * Adopt a clip into the library: copy it into app-private document storage under a stable
 * name, then read its real metadata.
 *
 * The copy is the point, not an optimisation. Neither source URI is ours to keep: a camera
 * recording lands in a temporary directory, and `expo-image-picker` hands back a copy in the
 * cache directory (`.../cache/…`) — both are reclaimable, and on Android a picked URI can
 * also be a `content://` grant that expires with the activity. FFmpeg additionally wants a
 * plain absolute path (see `export.ts`), which a `content://` URI is not.
 */
export async function adoptClip(uri: string, origin: ClipOrigin): Promise<Clip> {
  const capturedAt = Date.now();
  const n = ++counter;
  const name = `clip_${String(n).padStart(2, "0")}`;
  const dest = new File(clipsDir(), `${origin}-${capturedAt}-${n}.${extensionOf(uri)}`);
  if (dest.exists) dest.delete();

  // A remote clip has to be materialised before it is usable: FFmpeg export takes a
  // bare filesystem path (see export.ts), and File.copy cannot read an https:// URI.
  if (/^https?:\/\//i.test(uri)) {
    await File.downloadFileAsync(uri, dest);
  } else {
    // `copy` is async — the previous version dropped the promise and then read `size`
    // off a file the platform had not finished writing.
    await new File(uri).copy(dest);
  }

  return describe(dest, origin, name, capturedAt);
}

/**
 * Everything previously recorded or imported, newest first.
 *
 * Called once at startup so a clip the user captured in an earlier session is still in the
 * library — the files outlive the process, and without this the in-memory list would not.
 * A file that no longer describes as a video is skipped rather than throwing the whole
 * restore away.
 */
export async function restoreClips(): Promise<Clip[]> {
  let entries: (File | Directory)[];
  try {
    entries = clipsDir().list();
  } catch {
    return [];
  }

  const found = entries
    .filter((e): e is File => e instanceof File)
    .map((file) => ({ file, match: STORED.exec(file.name) }))
    .filter((e): e is { file: File; match: RegExpExecArray } => e.match !== null)
    .map(({ file, match }) => ({
      file,
      origin: match[1] as ClipOrigin,
      capturedAt: Number(match[2]),
      n: Number(match[3]),
    }))
    .sort((a, b) => a.capturedAt - b.capturedAt);

  // Keep numbering continuous with what is already on disk, so the next capture is not
  // called clip_01 again next to a restored clip_01.
  counter = Math.max(counter, ...found.map((f) => f.n), 0);

  const clips = await Promise.all(
    found.map((f, i) =>
      describe(f.file, f.origin, `clip_${String(i + 1).padStart(2, "0")}`, f.capturedAt).catch(
        () => null
      )
    )
  );

  return clips.filter((c): c is Clip => c !== null).reverse();
}
