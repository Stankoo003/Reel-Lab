import { optionalUser, requireUser } from "@/lib/auth";
import { body, json, noContent, route, uuidParam } from "@/lib/handler";
import { UpdateVideoPublishedRequest } from "@/lib/schemas";
import { videoResponse } from "@/services/dto";
import { summarise } from "@/services/likes";
import { remove, requireVideo, setPublished, toResponses } from "@/services/videos";

export const GET = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const viewer = await optionalUser(req);
  const [response] = await toResponses([await requireVideo(id)], viewer?.userId ?? null);
  return json(response);
});

export const PATCH = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const request = await body(req, UpdateVideoPublishedRequest);
  const video = await setPublished(id, request.published, userId);
  const likes = await summarise([id], null);
  // Publishing is something you do to your own video, and you do not follow yourself.
  return json(videoResponse(video, likes.counts.get(id) ?? 0, false, false));
});

export const DELETE = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  await remove(id, userId);
  return noContent();
});
