/**
 * Where uploaded bytes live. Two implementations — local disk for development, Cloudflare R2
 * (S3 API) deployed — behind one interface, chosen by MEDIA_STORAGE.
 *
 * The client never streams a file through this server: a serverless function accepts a few
 * megabytes of body and a clip is hundreds. Instead the server hands out a signed PUT URL for
 * a path it chose, the client uploads straight to storage, and the server verifies the object
 * when the path is later attached to a video or a profile.
 */
export type ObjectInfo = { size: number; contentType: string | null };

export interface MediaStorage {
  /** A URL the client may PUT exactly these bytes to, and the headers it must send. */
  presignPut(path: string, contentType: string, size: number): Promise<{ uploadUrl: string; headers: Record<string, string> }>;
  /** Size and type of a stored object, or null when there is none at that path. */
  head(path: string): Promise<ObjectInfo | null>;
  /** The first `length` bytes — for checking an image's magic number after upload. */
  readHead(path: string, length: number): Promise<Uint8Array | null>;
  /** Remove an object. A missing one is not an error. */
  delete(path: string): Promise<void>;
}

import { config } from "@/lib/config";
import { LocalStorage } from "./local";
import { R2Storage } from "./r2";

let instance: MediaStorage | undefined;

export function storage(): MediaStorage {
  if (!instance) instance = config.media.storage === "r2" ? new R2Storage() : new LocalStorage();
  return instance;
}
