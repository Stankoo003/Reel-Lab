/**
 * Upload paths and the rules on them. The bytes go straight from the client to storage; this
 * decides where, what kind, and — once a path is attached to something — whether what landed
 * there is what was allowed.
 */
import { randomUUID } from "node:crypto";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { config } from "@/lib/config";
import { storage } from "@/storage";

export type Kind = "video" | "poster" | "avatar";

const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov",
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
};

export function parseKind(kind: string | null): Kind {
  if (kind === "video" || kind === "poster" || kind === "avatar") return kind;
  throw new ValidationError("kind must be 'video', 'poster' or 'avatar'");
}

/** Allowlist with no fallback: an SVG stored as .jpg on the API's own origin is stored XSS. */
function extensionFor(contentType: string | null, expectedPrefix: string): string {
  const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
  const extension = EXTENSIONS[type];
  if (!extension || !type.startsWith(expectedPrefix)) {
    throw new ValidationError(`Expected a supported ${expectedPrefix}* type but got ${type || "no content type"}`);
  }
  return extension;
}

export function limitFor(kind: Kind): number {
  return kind === "avatar" ? config.media.avatarMaxBytes : config.media.maxBytes;
}

/** Whether this kind of upload is allowed at all under MEDIA_UPLOADS. */
export function uploadAllowed(kind: Kind): boolean {
  const mode = config.media.uploads;
  return mode === "on" || (mode === "avatars" && kind === "avatar");
}

function pathFor(kind: Kind, contentType: string): { path: string; type: string } {
  const id = randomUUID();
  const type = contentType.toLowerCase().split(";")[0].trim();
  switch (kind) {
    case "video": return { path: `videos/uploads/${id}/clip.${extensionFor(type, "video/")}`, type };
    case "poster": return { path: `posters/uploads/${id}.${extensionFor(type, "image/")}`, type };
    case "avatar": return { path: `avatars/${id}.${extensionFor(type, "image/")}`, type };
  }
}

export type Presigned = { path: string; uploadUrl: string; headers: Record<string, string> };

export const UPLOADS_DISABLED = "Uploads are switched off on this server.";

/**
 * Remove a replaced avatar from storage, so a user occupies one avatar's worth of space
 * however many times they change it. Only paths this server issued are touched; anything else
 * (a seed path, a file outside the avatars prefix) is left alone. Best effort: a failure to
 * delete is logged, never surfaced — the profile change already succeeded.
 */
export async function discardAvatar(path: string | null | undefined): Promise<void> {
  if (!path || !path.startsWith(PREFIXES.avatar)) return;
  try {
    await storage().delete(path);
  } catch (e) {
    console.error(`Could not delete replaced avatar ${path}`, e);
  }
}

export async function presign(kind: Kind, contentType: string | null, size: number): Promise<Presigned> {
  // Checked first, before anything is validated or signed: when the switch is off for this
  // kind there is no upload URL to hand out, to anybody.
  if (!uploadAllowed(kind)) throw new ForbiddenError(UPLOADS_DISABLED);
  if (!Number.isInteger(size) || size <= 0) throw new ValidationError("file part is empty");
  const limit = limitFor(kind);
  if (size > limit) throw new ValidationError(`Upload exceeds the ${limit} byte limit for this kind of file`);
  const { path, type } = pathFor(kind, contentType ?? "");
  const signed = await storage().presignPut(path, type, size);
  return { path, ...signed };
}

const PREFIXES: Record<Kind, string> = { video: "videos/uploads/", poster: "posters/uploads/", avatar: "avatars/" };

function looksLikeImage(head: Uint8Array): boolean {
  const startsWith = (magic: number[], at = 0) => head.length >= at + magic.length && magic.every((b, i) => head[at + i] === b);
  if (startsWith([0xff, 0xd8, 0xff]) || startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true;
  return head.length >= 12 && startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
}

/**
 * Whether an uploaded path may be attached. Only paths this server hands out are of a shape
 * that passes; anything else — a seed path, a CDN-side file — is left alone, because the
 * database rule (relative, no traversal) still applies and the media may legitimately live
 * outside the upload prefixes.
 */
export async function verifyUploaded(kind: Kind, path: string | null | undefined): Promise<void> {
  if (!path || !path.startsWith(PREFIXES[kind])) return;
  const info = await storage().head(path);
  if (!info) throw new ValidationError(`${kind} has not been uploaded yet`);
  if (info.size <= 0) throw new ValidationError("file part is empty");
  if (info.size > limitFor(kind)) throw new ValidationError(`Upload exceeds the ${limitFor(kind)} byte limit for this kind of file`);
  if (kind === "avatar") {
    const head = await storage().readHead(path, 12);
    if (!head || !looksLikeImage(head)) {
      throw new ValidationError("An avatar must be a JPEG, PNG or WebP image; the uploaded bytes are not one");
    }
  }
}
