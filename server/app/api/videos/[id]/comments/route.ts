import { requireUser } from "@/lib/auth";
import { decodeCursor, nextCursor } from "@/lib/cursor";
import { body, intQuery, json, query, route, uuidParam } from "@/lib/handler";
import { CreateCommentRequest } from "@/lib/schemas";
import { add, commentResponse, threadFor } from "@/services/comments";

export const GET = route(async (req, ctx) => {
  const videoId = await uuidParam(ctx, "id");
  const params = query(req);
  const limit = intQuery(params, "limit", 20, 1, 50);
  const thread = await threadFor(videoId, decodeCursor(params.get("cursor")), limit);
  const items = thread.roots.map((root) => commentResponse(root, thread.replies.get(root.id) ?? []));
  const rows = thread.roots.map((c) => ({ createdAt: c.created_at, id: c.id }));
  return json({ items, nextCursor: nextCursor(rows, thread.hasNext), hasNext: thread.hasNext });
});

/** 200, not 201 — as the Spring endpoint answered. */
export const POST = route(async (req, ctx) => {
  const videoId = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const request = await body(req, CreateCommentRequest);
  const saved = await add(videoId, userId, request.parentId ?? null, request.body);
  return json(commentResponse(saved, []));
});
