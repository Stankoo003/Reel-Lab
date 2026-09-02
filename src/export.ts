// The single export pass the design's Export screen visualises.
// Trim + text + audio are composed into ONE filter graph and encoded once —
// the whole point the spike set out to prove (see SPIKE-FINDINGS.md §2).
import { loadKit, HW } from "./ffmpeg";
import { spikeAssets, outPath, toPath, overlayTextPath } from "./assets";
import type { EditSettings, ExportResult, TextPosition, TextSize } from "./types";

export type TextPositionDef = {
  label: string;
  /** The drawtext `y` expression. */
  y: string;
  /** Places the editor's ghost box to match; a partial ViewStyle. */
  preview: { top?: number; bottom?: number };
};

/** Where the text sits, as offered by the design's Top / Lower third / Bottom control. */
export const TEXT_POSITIONS: Record<TextPosition, TextPositionDef> = {
  // `y` is the drawtext expression; `preview` places the editor's ghost box to match.
  top: { label: "Top", y: "120", preview: { top: 20, bottom: undefined } },
  lower: { label: "Lower third", y: "h-220", preview: { bottom: 34 } },
  bottom: { label: "Bottom", y: "h-110", preview: { bottom: 10 } },
};

export const TEXT_SIZES: Record<TextSize, number> = { S: 44, M: 64, L: 92 };

export const TEXT_COLORS: string[] = ["#FFFFFF", "#111111", "#F2C230", "#4C8DF6"];

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
  /** File holding the overlay text — see overlayTextPath. */
  textPath: string;
  trimIn: number;
  trimOut: number;
  /** Absolute path to the music bed, or null for no mix. */
  musicPath?: string | null;
};

export function buildComposeCommand({
  srcPath,
  outFile,
  fontPath,
  textPath,
  trimIn,
  trimOut,
  text,
  textPosition = "lower",
  textSize = "M",
  textColor = "#FFFFFF",
  musicPath,
  musicGainDb = -6,
  originalGainDb = -18,
}: ComposeInput): string {
  const duration = Math.max(0.1, trimOut - trimIn);
  const parts = [];
  const filters = [];

  parts.push(`-y -ss ${trimIn.toFixed(2)} -to ${trimOut.toFixed(2)} -i "${srcPath}"`);
  if (musicPath) parts.push(`-i "${musicPath}"`);

  // video branch
  if (text?.trim()) {
    const pos = TEXT_POSITIONS[textPosition] ?? TEXT_POSITIONS.lower;
    const size = TEXT_SIZES[textSize] ?? TEXT_SIZES.M;
    const hex = textColor.replace("#", "0x");
    // textfile= keeps ':' and quotes out of the graph; expansion=none stops drawtext
    // expanding '%' and '{}' — without it "50%" renders nothing and still exits 0.
    filters.push(
      `[0:v]drawtext=fontfile='${fontPath}':textfile='${textPath}':reload=0:expansion=none:` +
        `x=(w-tw)/2:y=${pos.y}:fontsize=${size}:fontcolor=${hex}:` +
        `box=1:boxcolor=black@0.5:boxborderw=16[v]`
    );
  } else {
    filters.push(`[0:v]null[v]`);
  }

  // audio branch
  if (musicPath) {
    // -ss/-to before -i apply to input 0 only, so the music gets its own atrim.
    filters.push(`[1:a]atrim=0:${duration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${musicGainDb}dB[m]`);
    filters.push(`[0:a]volume=${originalGainDb}dB[o]`);
    // normalize=0 — amix otherwise halves every input.
    filters.push(`[o][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`);
  } else {
    filters.push(`[0:a]anull[a]`);
  }

  parts.push(`-filter_complex "${filters.join(";")}"`);
  parts.push(`-map "[v]" -map "[a]"`);
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
  const { fontPath, musicPath } = await spikeAssets();
  const out = outPath("reellab-export.mp4");
  const textPath = overlayTextPath(settings.text ?? "");

  const cmd = buildComposeCommand({
    ...settings,
    srcPath: toPath(settings.sourceUri),
    outFile: out.path,
    fontPath,
    textPath,
    // settings.music is the editor's on/off toggle; the graph needs the actual path.
    musicPath: settings.music ? musicPath : null,
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
          resolve({ ok: true, cmd, ms, out: out.uri });
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
