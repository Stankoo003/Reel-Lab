// Spike helper: materialise bundled assets to real filesystem paths.
// FFmpeg needs plain absolute paths — not asset:// / file:// URIs.
import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import type { MusicTrackId } from "./types";

const FONT = require("../assets/spike/font.ttf");

/**
 * The bundled music beds.
 *
 * All three are SYNTHESISED by FFmpeg oscillators in `scripts/media/make-audio.sh` —
 * no third-party sample, loop pack or recording is involved, so they carry no
 * third-party rights. Re-running that script reproduces them byte-for-byte-ish.
 * Licence and credit: `scripts/media/ATTRIBUTION.md`, surfaced in-app on the AUDIO tab.
 *
 * `seconds` is the real file length; the editor uses it to tell the user up front whether
 * the bed will loop or be trimmed for the current clip (see src/export.ts).
 */
export type MusicTrack = {
  id: MusicTrackId;
  /** Shown in the AUDIO tab's track row. */
  name: string;
  /** One-line character description, under the name. */
  blurb: string;
  seconds: number;
  /** Relative amplitudes for the row's waveform bars, 0…100. */
  wave: number[];
  mod: number;
};

export const MUSIC_TRACKS: MusicTrack[] = [
  {
    id: "pulse",
    name: "Pulse",
    blurb: "Low pulse, 120 bpm",
    seconds: 8,
    wave: [95, 40, 70, 30, 95, 45],
    mod: require("../assets/spike/audio/pulse.m4a"),
  },
  {
    id: "drift",
    name: "Drift",
    blurb: "Slow major pad",
    seconds: 30,
    wave: [35, 55, 70, 80, 65, 45],
    mod: require("../assets/spike/audio/drift.m4a"),
  },
  {
    id: "ticker",
    name: "Ticker",
    blurb: "Four-note arpeggio",
    seconds: 20,
    wave: [50, 100, 60, 85, 45, 75],
    mod: require("../assets/spike/audio/ticker.m4a"),
  },
];

/** Credit line for the bundled beds. Shown on the AUDIO tab — attribution belongs in the app. */
export const MUSIC_CREDIT =
  "Beds generated with FFmpeg for ReelLab · CC0 1.0 public domain";

export function musicTrack(id: MusicTrackId): MusicTrack {
  return MUSIC_TRACKS.find((t) => t.id === id) ?? MUSIC_TRACKS[0];
}

/** Strip the file:// scheme and percent-decode. FFmpeg wants /var/... not file:///var/... */
export function toPath(uri: string): string {
  if (!uri) return uri;
  return decodeURIComponent(String(uri).replace(/^file:\/\//, ""));
}

async function materialise(mod: number, name: string) {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const dest = new File(Paths.cache, name);
  if (dest.exists) dest.delete();
  new File(asset.localUri ?? asset.uri).copy(dest);
  return dest.uri;
}

type SpikeAssets = { fontPath: string; fontUri: string };

let cached: SpikeAssets | null = null;

/** Returns the absolute filesystem path for the drawtext font. */
export async function spikeAssets(): Promise<SpikeAssets> {
  if (cached) return cached;
  const fontUri = await materialise(FONT, "spike-font.ttf");
  cached = { fontPath: toPath(fontUri), fontUri };
  return cached;
}

const trackCache = new Map<MusicTrackId, string>();

/**
 * Absolute filesystem path for one bundled bed. Only the chosen track is copied out of
 * the bundle, and only once per session — an export must not pay for the other two.
 */
export async function musicTrackPath(id: MusicTrackId): Promise<string> {
  const hit = trackCache.get(id);
  if (hit) return hit;
  const track = musicTrack(id);
  const path = toPath(await materialise(track.mod, `spike-music-${track.id}.m4a`));
  trackCache.set(track.id, path);
  return path;
}

/** A fresh output path in cache. Deletes any previous file at that name. */
export function outPath(name: string) {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  return { uri: f.uri, path: toPath(f.uri), file: f };
}

/**
 * Write the overlay text to a file and return its absolute path.
 *
 * drawtext's `text=` is parsed as part of the filter string, so ':' , '\' and quotes in
 * user input break the graph (or worse, inject filter options). `textfile=` reads the
 * literal bytes instead, so arbitrary text — including emoji and Serbian diacritics — is safe.
 */
export function overlayTextPath(text: string | null | undefined): string {
  const f = new File(Paths.cache, "spike-overlay.txt");
  if (f.exists) f.delete();
  f.create();
  f.write(text ?? "");
  return toPath(f.uri);
}
