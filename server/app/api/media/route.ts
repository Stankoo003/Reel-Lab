import { requireUser } from "@/lib/auth";
import { body, json, query, route } from "@/lib/handler";
import { PresignRequest } from "@/lib/schemas";
import { parseKind, presign } from "@/services/media";

/**
 * Where to put a file. `?kind=video|poster|avatar` and `{contentType, size}` in; a relative path
 * and a signed PUT URL out. The client uploads the bytes there itself, then hands the path to
 * POST /api/videos or PATCH /api/users/{id}, which verify what landed.
 */
export const POST = route(async (req) => {
  await requireUser(req);
  const kind = parseKind(query(req).get("kind"));
  const request = await body(req, PresignRequest);
  return json(await presign(kind, request.contentType ?? null, request.size));
});
