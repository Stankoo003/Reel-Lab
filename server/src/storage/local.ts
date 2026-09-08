/**
 * Development storage: the media directory on disk, uploaded through PUT /api/media/local and
 * served by GET /media/[...path]. Never used deployed — a serverless filesystem is not kept.
 */
import { createHash } from "node:crypto";
import { open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import type { MediaStorage, ObjectInfo } from "./index";

export function mediaRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), config.media.directory);
}

/** Resolves a relative path inside the media root, refusing anything that escapes it. */
export function resolveInsideRoot(relative: string): string | null {
  const root = mediaRoot();
  const target = path.resolve(/*turbopackIgnore: true*/ root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** A short HMAC so only a path this server handed out can be written. */
export function localUploadSignature(relative: string, contentType: string, size: number): string {
  return createHash("sha256").update(`${config.auth.secret}|${relative}|${contentType}|${size}`).digest("hex").slice(0, 32);
}

export class LocalStorage implements MediaStorage {
  async presignPut(relative: string, contentType: string, size: number) {
    const params = new URLSearchParams({ path: relative, type: contentType, size: String(size),
      sig: localUploadSignature(relative, contentType, size) });
    return {
      uploadUrl: `${config.mail.webBaseUrl}/api/media/local?${params}`,
      headers: { "Content-Type": contentType },
    };
  }

  async head(relative: string): Promise<ObjectInfo | null> {
    const target = resolveInsideRoot(relative);
    if (!target) return null;
    try {
      const s = await stat(/*turbopackIgnore: true*/ target);
      return s.isFile() ? { size: s.size, contentType: null } : null;
    } catch {
      return null;
    }
  }

  async readHead(relative: string, length: number): Promise<Uint8Array | null> {
    const target = resolveInsideRoot(relative);
    if (!target) return null;
    try {
      const fh = await open(/*turbopackIgnore: true*/ target, "r");
      try {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await fh.read(buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    } catch {
      return null;
    }
  }

  async delete(relative: string): Promise<void> {
    const target = resolveInsideRoot(relative);
    if (!target) return;
    await rm(/*turbopackIgnore: true*/ target, { force: true });
  }
}
