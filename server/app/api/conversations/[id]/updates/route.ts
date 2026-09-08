import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { json, query, route, uuidParam } from "@/lib/handler";
import { parseInstant } from "@/lib/time";
import { requireParticipant } from "@/services/conversations";
import { messageDto, otherReceipt, since } from "@/services/messages";

/**
 * What a polling client asks every few seconds: the messages after a moment AND the other
 * side's receipt, in one round trip. Replaces the STOMP topic the Spring server published on.
 */
export const GET = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const raw = query(req).get("after");
  const after = raw ? parseInstant(raw) : "1970-01-01T00:00:00Z";
  if (!after) throw new ApiError(400, "after must be a valid Instant");
  const conversation = await requireParticipant(id, userId);
  const [messages, receipt] = await Promise.all([since(id, userId, after), otherReceipt(conversation, userId)]);
  return json({ messages: messages.map((m) => messageDto(m, null)), otherReceipt: receipt });
});
