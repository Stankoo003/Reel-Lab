// Shared shapes across the editor: the clip, the staged edit, and the export result.
import type { ImageSource } from "expo-image";
import type { VideoThumbnail } from "expo-video";

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

/** Keys of TEXT_SIZE_PRESETS in src/export.ts — the design's S / M / L boxes. */
export type TextSizePreset = "S" | "M" | "L";

/**
 * One burned-in caption.
 *
 * Geometry is stored NORMALISED — as fractions of the video frame, never in pixels —
 * because the editor's preview and FFmpeg's `drawtext` are two different coordinate
 * systems, and the only way they can agree is by deriving from the same number:
 *
 *   preview: left = rect.x + x * rect.w     export: x=w*<x>-text_w/2
 *   preview: fontSize = size * rect.h       export: fontsize=round(size * frameHeight)
 *
 * `x`/`y` are the CENTRE of the text box, 0…1. `size` is the font size as a fraction of
 * the frame height (0.059 ≈ 64px on a 1080p frame — the old "M" preset).
 */
export type TextElement = {
  id: string;
  text: string;
  /** Centre of the box, as a fraction of frame width. 0…1. */
  x: number;
  /** Centre of the box, as a fraction of frame height. 0…1. */
  y: number;
  /** Font size as a fraction of frame height. */
  size: number;
  /** "#RRGGBB" — one of TEXT_COLORS, or anything drawtext accepts. */
  color: string;
};

/** The staged edit. Handed to runExport as-is, plus a sourceUri. */
export type EditSettings = {
  trimIn: number;
  trimOut: number;
  /** Every caption to burn in. Empty means no drawtext at all in the filter graph. */
  texts: TextElement[];
  /**
   * The source video's pixel size, once expo-video reports it. Optional because the
   * editor only learns it after the player loads; export falls back to 1920×1080.
   * Font sizes resolve against `frameHeight`, so preview px and drawtext px match.
   */
  frameWidth?: number;
  frameHeight?: number;
  /** The editor's on/off toggle for the music bed. */
  music: boolean;
  musicGainDb: number;
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
