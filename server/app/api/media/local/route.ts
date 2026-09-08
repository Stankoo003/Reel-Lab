import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { ApiError, ValidationError } from "@/lib/errors";
import { noContent, query, route } from "@/lib/handler";
import { localUploadSignature, resolveInsideRoot } from "@/storage/local";

/** The PUT target LocalStorage signs. Development only; disabled when R2 is the storage. */
export const PUT = route(async (req) => {
  if (config.media.storage !== "local") throw new ApiError(404, "Not Found");
  if (config.media.uploads === "off") throw new ApiError(403, "Uploads are switched off on this server.");
  const params = query(req);
  const relative = params.get("path") ?? "";
  const type = params.get("type") ?? "";
  const size = Number(params.get("size"));
  if (params.get("sig") !== localUploadSignature(relative, type, size)) throw new ApiError(403, "Upload URL is not valid");
  const target = resolveInsideRoot(relative);
  if (!target) throw new ValidationError("Resolved path escapes the media directory");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) throw new ValidationError("file part is empty");
  if (bytes.byteLength > size) throw new ValidationError(`Upload exceeds the ${size} byte limit for this kind of file`);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ target, bytes);
  return noContent();
});
