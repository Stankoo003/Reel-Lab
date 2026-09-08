import { requireUser } from "@/lib/auth";
import { json, route, uuidParam } from "@/lib/handler";
import { toIso } from "@/lib/time";
import { markReadNow } from "@/services/messages";

/** Opening a thread reads it to the end — the only place unread is cleared. */
export const POST = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const row = await markReadNow(id, userId);
  return json({ conversationId: id, lastReadAt: toIso(row.last_read_at), unreadCount: 0 });
});
