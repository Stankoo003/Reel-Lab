import { requireUser } from "@/lib/auth";
import { body, json, noContent, route, uuidParam } from "@/lib/handler";
import { UpdateCommentRequest } from "@/lib/schemas";
import { commentResponse, edit, remove } from "@/services/comments";

export const PATCH = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const request = await body(req, UpdateCommentRequest);
  const edited = await edit(id, request.body, userId);
  return json(commentResponse(edited.comment, edited.replies));
});

export const DELETE = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  await remove(id, userId);
  return noContent();
});
