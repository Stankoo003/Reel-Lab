// Trim range maths and the numeric check that the exported file really is the
// selected range.
//
// The acceptance criterion for TRIM is "exported file matches the selected range,
// verified by duration, not by eye" — so the check lives here as a pure function
// plus one probe-backed wrapper, and both the export pass and the Result screen
// call it. Nothing here renders, so it stays testable from either side.
import { probe } from "./ffmpeg";
import { toPath } from "./assets";

/** Shortest selection the handles may produce, in seconds. */
export const MIN_TRIM = 0.2;

/**
 * How far the written file may differ from the requested range before the check
 * fails, in seconds.
 *
 * Not zero on purpose: `-ss` seeks to the nearest keyframe-decodable point and the
 * encoder writes whole frames, so a 30 fps source can legitimately land a frame or
 * two either side. A quarter of a second is ~7 frames at 30 fps — wide enough to
 * absorb that, far too narrow to hide a trim that was ignored.
 */
export const TRIM_TOLERANCE = 0.25;

export type TrimCheck = {
  /** trimOut − trimIn, the range the operator selected. */
  expected: number;
  /** Duration ffprobe read back off the written file. */
  actual: number;
  /** actual − expected, signed. */
  delta: number;
  tolerance: number;
  ok: boolean;
};

/** Clamp a raw seconds value into a legal in-point for the given out-point. */
export function clampIn(value: number, out: number): number {
  return Math.max(0, Math.min(value, out - MIN_TRIM));
}

/** Clamp a raw seconds value into a legal out-point for the given in-point and duration. */
export function clampOut(value: number, inPoint: number, duration: number): number {
  return Math.min(duration, Math.max(value, inPoint + MIN_TRIM));
}

export function checkTrim(expected: number, actual: number, tolerance = TRIM_TOLERANCE): TrimCheck {
  const delta = actual - expected;
  return {
    expected,
    actual,
    delta,
    tolerance,
    ok: Number.isFinite(actual) && actual > 0 && Math.abs(delta) <= tolerance,
  };
}

/**
 * Probe the written file and compare its duration with the requested range.
 * Returns null when ffprobe is unavailable or gave no duration — a missing check
 * is reported as missing rather than silently passing.
 */
export async function verifyTrimmedFile(
  uri: string,
  expected: number,
  tolerance = TRIM_TOLERANCE
): Promise<TrimCheck | null> {
  try {
    const info = await probe(toPath(uri));
    const raw = info?.format?.duration;
    if (raw == null) return null;
    const actual = Number(raw);
    if (!Number.isFinite(actual)) return null;
    return checkTrim(expected, actual, tolerance);
  } catch {
    return null;
  }
}

/** One-line human form: "11.40s asked · 11.42s written (+0.02s)". */
export function describeTrimCheck(check: TrimCheck): string {
  const sign = check.delta >= 0 ? "+" : "−";
  return (
    `${check.expected.toFixed(2)}s asked · ${check.actual.toFixed(2)}s written ` +
    `(${sign}${Math.abs(check.delta).toFixed(2)}s)`
  );
}
