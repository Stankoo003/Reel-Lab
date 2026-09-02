// Spike helper: materialise bundled assets to real filesystem paths.
// FFmpeg needs plain absolute paths — not asset:// / file:// URIs.
import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";

const FONT = require("../assets/spike/font.ttf");
const MUSIC = require("../assets/spike/music.m4a");

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

type SpikeAssets = { fontPath: string; musicPath: string; fontUri: string; musicUri: string };

let cached: SpikeAssets | null = null;

/** Returns absolute filesystem paths for the drawtext font and the music bed. */
export async function spikeAssets(): Promise<SpikeAssets> {
  if (cached) return cached;
  const [fontUri, musicUri] = await Promise.all([
    materialise(FONT, "spike-font.ttf"),
    materialise(MUSIC, "spike-music.m4a"),
  ]);
  cached = { fontPath: toPath(fontUri), musicPath: toPath(musicUri), fontUri, musicUri };
  return cached;
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
 *
 * `index` keeps the files of multiple overlay elements apart within one export.
 */
export function overlayTextPath(text: string | null | undefined, index = 0): string {
  const f = new File(Paths.cache, `spike-overlay-${index}.txt`);
  if (f.exists) f.delete();
  f.create();
  f.write(text ?? "");
  return toPath(f.uri);
}
