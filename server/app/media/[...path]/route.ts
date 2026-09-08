import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { config } from "@/lib/config";
import { resolveInsideRoot } from "@/storage/local";

const TYPES: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};

/**
 * Serves the local media directory with Range support, which is what makes mp4 seeking work.
 * Development only: deployed, MEDIA_CDN_BASE_URL points at the bucket and this is never hit.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (config.media.storage !== "local") return new Response(null, { status: 404 });
  const relative = (await ctx.params).path.map(decodeURIComponent).join("/");
  const target = resolveInsideRoot(relative);
  if (!target) return new Response(null, { status: 404 });
  let size: number;
  try {
    const s = await stat(/*turbopackIgnore: true*/ target);
    if (!s.isFile()) return new Response(null, { status: 404 });
    size = s.size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const ext = relative.split(".").pop()?.toLowerCase() ?? "";
  const headers: Record<string, string> = {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "max-age=2592000, public",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ target, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new Response(Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ target)) as ReadableStream, { status: 200, headers });
}
