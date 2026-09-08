import { optionalUser, requireUser } from "@/lib/auth";
import { body, intQuery, json, query, route, uuidQuery } from "@/lib/handler";
import { CreateVideoRequest } from "@/lib/schemas";
import { videoResponse } from "@/services/dto";
import { verifyUploaded } from "@/services/media";
import { create, list, toResponses } from "@/services/videos";

/** Offset listing in the Spring Page envelope. publishedOnly=false includes drafts; ownerId narrows. */
export const GET = route(async (req) => {
  const viewer = await optionalUser(req);
  const params = query(req);
  const publishedOnly = params.get("publishedOnly") !== "false";
  const ownerId = uuidQuery(params, "ownerId");
  const page = intQuery(params, "page", 0, 0, 1_000_000);
  const size = intQuery(params, "size", 20, 1, 200);
  const result = await list(publishedOnly, ownerId, page, size);
  return json({ ...result, content: await toResponses(result.content, viewer?.userId ?? null) });
});

export const POST = route(async (req) => {
  const { userId } = await requireUser(req);
  const request = await body(req, CreateVideoRequest);
  await verifyUploaded("video", request.manifestPath);
  await verifyUploaded("poster", request.posterPath);
  const video = await create(userId, request.title, request.description ?? null, request.durationSeconds,
    request.manifestPath, request.posterPath ?? null);
  return json(videoResponse(video, 0, false, false), { status: 201, headers: { Location: `/api/videos/${video.id}` } });
});
