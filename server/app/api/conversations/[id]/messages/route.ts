import { requireUser } from "@/lib/auth";
import { decodeCursor, nextCursor } from "@/lib/cursor";
import { body, json, query, route, uuidParam } from "@/lib/handler";
import { SendMessageRequest } from "@/lib/schemas";
import { requireParticipant } from "@/services/conversations";
import { messageDto, otherReceipt, page, send } from "@/services/messages";

/** One page of history, newest first. */
export const GET = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const params = query(req);
  const limitRaw = params.get("limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  const rows = await page(id, userId, decodeCursor(params.get("cursor")), Number.isFinite(limit) ? limit : null);
  // A full page means there is probably more — a hint that costs nothing, not a promise.
  const asked = limit == null ? rows.length : limit;
  const hasMore = rows.length > 0 && rows.length >= asked;
  const conversation = await requireParticipant(id, userId);
  return json({
    items: rows.map((m) => messageDto(m, null)),
    nextCursor: nextCursor(rows.map((m) => ({ createdAt: m.created_at, id: m.id })), hasMore),
    hasMore,
    otherReceipt: await otherReceipt(conversation, userId),
  });
});

export const POST = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const request = await body(req, SendMessageRequest);
  const saved = await send(id, userId, request.body ?? null, request.videoId ?? null);
  return json(messageDto(saved, request.clientId ?? null));
});
