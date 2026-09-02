// Shared shapes across the editor: the clip, the staged edit, and the export result.
import type { ImageSource } from "expo-image";
import type { VideoThumbnail } from "expo-video";
import type { TrimCheck } from "./trim";

/** Where a clip came from. `library` clips exist on the server; the rest are local only. */
export type ClipOrigin = "camera" | "gallery" | "library";

/**
 * A poster frame. Locally adopted clips carry expo-video's native thumbnail object,
 * server clips a plain CDN URL — expo-image takes either.
 */
export type ClipThumb = ImageSource | VideoThumbnail | null;

/** A clip as the editor and the feed see it. Built by `adoptClip` and by `toClip`. */
export type Clip = {
  id: string;
  name: string;
  /** Playable URI: a local file:// for adopted clips, a CDN URL for library ones. */
  uri: string;
  /** Absolute filesystem path for FFmpeg, or null while the clip is still remote. */
  path: string | null;
  origin: ClipOrigin;
  remote?: boolean;
  published?: boolean;
  ownerId?: string;
  ownerName?: string;
  duration: number;
  durationLabel: string;
  bytes: number;
  /** Capture time for local clips, "published"/"draft" for server ones. */
  when: string;
  thumb: ClipThumb;
  /** Server clips only. Local clips have no likes because they have no server row. */
  likeCount?: number;
  likedByViewer?: boolean;
};

/** Keys of MUSIC_TRACKS in src/assets.ts — which bundled bed to mix in. */
export type MusicTrackId = "pulse" | "drift" | "ticker";

/** Keys of TEXT_POSITIONS in src/export.ts. */
export type TextPosition = "top" | "lower" | "bottom";
/** Keys of TEXT_SIZES in src/export.ts. */
export type TextSize = "S" | "M" | "L";

/** The staged edit. Handed to runExport as-is, plus a sourceUri. */
export type EditSettings = {
  trimIn: number;
  trimOut: number;
  text: string;
  textPosition: TextPosition;
  textSize: TextSize;
  textColor: string;
  /** The editor's on/off toggle for the music bed. */
  music: boolean;
  /** Which bundled bed to mix in when `music` is on. */
  musicTrackId: MusicTrackId;
  musicGainDb: number;
  /**
   * Original-audio level. At MUTE_DB (src/export.ts) the original stream is dropped from
   * the graph entirely, so "mute" is silence, not a very quiet track.
   */
  originalGainDb: number;
};

/** A finished export: one encode, one output file. */
export type ExportSuccess = {
  ok: true;
  /** The exact FFmpeg command that ran. */
  cmd: string;
  /** Wall-clock duration of the pass, in ms. */
  ms: number;
  /** file:// URI of the rendered video. */
  out: string;
  /**
   * Did the written file's duration match trimOut − trimIn? null when ffprobe could
   * not measure it — never silently "yes". See src/trim.ts.
   */
  trim?: TrimCheck | null;
  error?: undefined;
};

/** A failed export. `error` is the tail of FFmpeg's output, or why it never started. */
export type ExportFailure = {
  ok: false;
  cmd?: string;
  ms?: number;
  out?: string;
  error?: string;
};

export type ExportResult = ExportSuccess | ExportFailure;
