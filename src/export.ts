// The single export pass the design's Export screen visualises.
// Trim + text + audio are composed into ONE filter graph and encoded once —
// the whole point the spike set out to prove (see SPIKE-FINDINGS.md §2).
import { loadKit, HW } from "./ffmpeg";
import { spikeAssets, outPath, toPath, overlayTextPath, musicTrackPath } from "./assets";
import { verifyTrimmedFile } from "./trim";
import type { EditSettings, ExportResult, TextElement, TextSizePreset } from "./types";

/**
 * TEXT GEOMETRY — the single source of truth shared by the preview and by drawtext.
 *
 * The old build had three canned positions whose `y` was a drawtext expression and whose
 * `preview` was the matching editor offset: two hand-kept numbers that had to be edited
 * together. Free dragging generalises that idea by removing the duplication entirely —
 * a TextElement stores x/y/size as FRACTIONS of the frame, and both sides derive from
 * them through the helpers below. Change a helper and both sides move together.
 */

/** Assumed frame size when expo-video has not reported the real one yet. */
export const DEFAULT_FRAME_WIDTH = 1920;
export const DEFAULT_FRAME_HEIGHT = 1080;

/** The design's S / M / L boxes, as a fraction of frame height (44 / 64 / 92 px @1080). */
export const TEXT_SIZE_PRESETS: Record<TextSizePreset, number> = {
  S: 44 / DEFAULT_FRAME_HEIGHT,
  M: 64 / DEFAULT_FRAME_HEIGHT,
  L: 92 / DEFAULT_FRAME_HEIGHT,
};

/** Bounds for the continuous size slider, in the same fraction-of-height unit. */
export const TEXT_SIZE_MIN = 20 / DEFAULT_FRAME_HEIGHT;
export const TEXT_SIZE_MAX = 140 / DEFAULT_FRAME_HEIGHT;

export const TEXT_COLORS: string[] = ["#FFFFFF", "#111111", "#F2C230", "#4C8DF6"];

/** Where a new element lands: horizontally centred, in the lower third. */
export const NEW_TEXT_X = 0.5;
export const NEW_TEXT_Y = 0.78;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Font size in pixels for a frame `frameHeight` tall. The preview passes the height of
 * the video rect on screen, the export passes the real frame height — same function,
 * so the text occupies the same share of the picture in both.
 */
export function textFontPx(el: Pick<TextElement, "size">, frameHeight: number): number {
  return Math.max(6, Math.round(el.size * frameHeight));
}

/** drawtext's boxborderw, derived from the font size so the plate scales with the text. */
export function textBoxPad(fontPx: number): number {
  return Math.max(2, Math.round(fontPx * 0.25));
}

/** Is this caption visible anywhere inside the cut? Outside it, drawtext would be dead weight. */
export function textInCut(el: TextElement, trimIn: number, trimOut: number): boolean {
  return el.end > trimIn && el.start < trimOut;
}

/** Elements that actually produce a drawtext. Empty input ⇒ no drawtext in the graph. */
export function drawableTexts(texts: TextElement[] | undefined | null): TextElement[] {
  return (texts ?? []).filter((t) => !!t.text?.trim());
}

/**
 * Bottom of both gain sliders. At this value the original audio is not merely attenuated —
 * its branch is dropped from the graph, because -40 dB is still audible on headphones and
 * users who ask for mute mean silence.
 */
/**
 * Level range for both the bed and the original, in dB.
 *
 * The top used to be 0 — you could only ever make a source quieter. A clip recorded far
 * from its subject is the ordinary case for a phone camera, and there was no way to lift it.
 *
 * +12 rather than more: past that, boosting a quiet recording mostly raises its noise floor,
 * and the limiter below is preventing distortion rather than making it sound good.
 */
export const GAIN_MAX_DB = 12;

export const MUTE_DB = -40;

/** Fade applied to the tail of the music bed so a trimmed or looped bed does not cut dead. */
const MUSIC_FADE_OUT = 0.6;

/**
 * Build the one-pass command. Kept as a pure function so the Export screen can
 * show the operator exactly what will run.
 */
export type ComposeInput = Partial<EditSettings> & {
  /** Absolute filesystem path to the source video. */
  srcPath: string;
  /** Absolute filesystem path to write. */
  outFile: string;
  fontPath: string;
  /**
   * One file per drawable text element, in the order `drawableTexts(texts)` returns —
   * see overlayTextPath. A caller that passes fewer paths than elements gets fewer
   * drawtext filters, never a drawtext with no text.
   */
  textPaths: string[];
  trimIn: number;
  trimOut: number;
  /** Absolute path to the music bed, or null for no mix. */
  musicPath?: string | null;
};

export function buildComposeCommand({
  srcPath,
  outFile,
  fontPath,
  textPaths,
  trimIn,
  trimOut,
  texts,
  frameHeight = DEFAULT_FRAME_HEIGHT,
  musicPath,
  musicGainDb = -6,
  originalGainDb = -18,
}: ComposeInput): string {
  const duration = Math.max(0.1, trimOut - trimIn);
  const parts = [];
  const filters = [];

  parts.push(`-y -ss ${trimIn.toFixed(2)} -to ${trimOut.toFixed(2)} -i "${srcPath}"`);
  // -stream_loop -1 repeats the bed forever; the atrim in the audio branch decides where
  // it actually stops. See the length-mismatch note there.
  if (musicPath) parts.push(`-stream_loop -1 -i "${musicPath}"`);

  // video branch — one drawtext per element, chained. No elements means no drawtext at
  // all (a plain null), which is what keeps an empty overlay set artefact-free.
  const drawn = drawableTexts(texts).slice(0, textPaths.length);
  if (!drawn.length) {
    filters.push(`[0:v]null[v]`);
  } else {
    drawn.forEach((el, i) => {
      const from = i === 0 ? "0:v" : `vt${i}`;
      const to = i === drawn.length - 1 ? "v" : `vt${i + 1}`;
      const fontPx = textFontPx(el, frameHeight);
      const hex = (el.color || "#FFFFFF").replace("#", "0x");
      // x/y place the CENTRE of the rendered box at the element's normalised point, so
      // the exported frame matches the editor ghost whatever the source resolution is.
      // fontsize stays a plain integer: drawtext's expression support for it varies by
      // build, and frameHeight is already known here.
      const x = `w*${clamp01(el.x).toFixed(4)}-text_w/2`;
      const y = `h*${clamp01(el.y).toFixed(4)}-text_h/2`;
      /*
        WHEN it shows. `enable` runs on the TRIMMED stream, where t = 0 is trimIn, but the
        element stores source-clip seconds — so both ends shift by trimIn here. Clamped to
        the cut, because a caption timed outside it would silently never appear.

        A caption covering the whole cut gets no `enable` at all: the filter is cheaper
        without one, and it keeps the common case out of the command entirely.
      */
      const from0 = Math.max(0, el.start - trimIn);
      const to0 = Math.min(duration, el.end - trimIn);
      const always = from0 <= 0 && to0 >= duration;
      const enable = always
        ? ""
        : `enable='between(t,${from0.toFixed(2)},${to0.toFixed(2)})':`;
      // textfile= keeps ':' and quotes out of the graph; expansion=none stops drawtext
      // expanding '%' and '{}' — without it "50%" renders nothing and still exits 0.
      filters.push(
        `[${from}]drawtext=fontfile='${fontPath}':textfile='${textPaths[i]}':reload=0:expansion=none:` +
          `${enable}x=${x}:y=${y}:fontsize=${fontPx}:fontcolor=${hex}:` +
          `box=1:boxcolor=black@0.5:boxborderw=${textBoxPad(fontPx)}[${to}]`
      );
    });
  }

  // audio branch
  //
  // LENGTH MISMATCH — the documented behaviour (README "Music beds"):
  //   bed SHORTER than the trimmed clip -> it LOOPS seamlessly until the clip ends;
  //   bed LONGER  than the trimmed clip -> it is TRIMMED to the clip.
  // `-stream_loop -1` on input 1 (added above) makes the demuxer repeat the file forever,
  // and the atrim below cuts the stream at the clip length, so one expression covers both
  // cases. aloop would need a sample-count buffer sized to the whole file; -stream_loop
  // does not. A short fade on the tail keeps the loop/trim point from cutting dead.
  //
  // MUTE — originalGainDb at MUTE_DB drops [0:a] from the graph instead of attenuating it.
  const muted = originalGainDb <= MUTE_DB;
  const hasBoost = originalGainDb > 0 || (!!musicPath && musicGainDb > 0);
  const fade = Math.min(MUSIC_FADE_OUT, duration / 4);

  if (musicPath) {
    // -ss/-to before -i apply to input 0 only, so the music gets its own atrim.
    filters.push(
      `[1:a]atrim=0:${duration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${musicGainDb}dB,` +
        `afade=t=out:st=${Math.max(0, duration - fade).toFixed(2)}:d=${fade.toFixed(2)}[m]`
    );
    if (muted) {
      // Original dropped entirely: the bed IS the soundtrack.
      filters.push(`[m]anull[a]`);
    } else {
      filters.push(`[0:a]volume=${originalGainDb}dB[o]`);
      // normalize=0 — amix otherwise halves every input. duration=longest, because both
      // branches are already bounded by the trim, and `first` would let a short original
      // audio stream cut the bed off early.
      filters.push(`[o][m]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]`);
    }
  } else if (!muted) {
    // volume, not anull. With no bed this branch used to pass the original through
    // untouched, so the level slider did nothing at all unless music happened to be on.
    filters.push(`[0:a]volume=${originalGainDb}dB[a]`);
  }

  // No bed and the original muted -> there is nothing to encode; -an keeps a silent
  // (rather than broken) file instead of mapping a label the graph never produced.
  const hasAudio = !!musicPath || !muted;

  // Boosting can push the sum past full scale, which clips as crackle rather than as
  // loudness. The limiter only enters the graph when something is actually being lifted —
  // it is not free, and at or below unity there is nothing for it to catch.
  if (hasBoost && hasAudio) {
    filters.push(`[a]alimiter=limit=0.95[al]`);
  }
  // Whichever label the audio chain actually ended on.
  const audioOut = hasAudio && hasBoost ? "[al]" : "[a]";

  parts.push(`-filter_complex "${filters.join(";")}"`);
  parts.push(hasAudio ? `-map "[v]" -map "${audioOut}"` : `-map "[v]" -an`);
  parts.push(`-c:v ${HW} -b:v 8M -c:a aac -b:a 192k -movflags +faststart "${outFile}"`);

  return parts.join(" ");
}

/**
 * Run the pass. onProgress(0..1) is driven by FFmpeg's own statistics callback,
 * so the percentage on screen is real encode progress, not a fake timer.
 */
export type ExportSettings = EditSettings & {
  /** The clip to read; must already be a local file. */
  sourceUri: string;
};

export type ExportHandlers = {
  /** Real encode progress, 0…1, from FFmpeg's statistics callback. */
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
};

export async function runExport(
  settings: ExportSettings,
  { onProgress, onLog }: ExportHandlers = {}
): Promise<ExportResult> {
  const { kit, loadError } = loadKit();
  if (!kit) return { ok: false, error: `FFmpegKit unavailable: ${loadError?.message}` };

  const { FFmpegKit, ReturnCode } = kit;
  const { fontPath } = await spikeAssets();
  // settings.music is the on/off toggle; musicTrackId picks WHICH bundled bed.
  const musicPath = settings.music ? await musicTrackPath(settings.musicTrackId) : null;
  const out = outPath("reellab-export.mp4");
  // One file per element, indexed so they do not overwrite one another.
  const textPaths = drawableTexts(settings.texts).map((el, i) => overlayTextPath(el.text, i));

  const cmd = buildComposeCommand({
    ...settings,
    srcPath: toPath(settings.sourceUri),
    outFile: out.path,
    fontPath,
    textPaths,
    // Already null when the toggle is off — see where musicPath is resolved above.
    musicPath,
  });

  const durationMs = Math.max(100, (settings.trimOut - settings.trimIn) * 1000);
  const started = Date.now();

  return new Promise<ExportResult>((resolve) => {
    FFmpegKit.executeAsync(
      cmd,
      async (session) => {
        const code = await session.getReturnCode();
        const ms = Date.now() - started;
        if (ReturnCode.isSuccess(code)) {
          // Measure the range that was actually written instead of trusting -ss/-to:
          // ffprobe reads the file back and the check travels with the result.
          const trim = await verifyTrimmedFile(out.uri, settings.trimOut - settings.trimIn);
          resolve({ ok: true, cmd, ms, out: out.uri, trim });
          return;
        }
        resolve({
          ok: false,
          cmd,
          ms,
          out: out.uri,
          error: String(await session.getOutput()).slice(-1500),
        });
      },
      (log) => onLog?.(String(log.getMessage())),
      (stat) => onProgress?.(Math.min(1, (stat.getTime() ?? 0) / durationMs))
    );
  });
}
