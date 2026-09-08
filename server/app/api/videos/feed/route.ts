import { optionalUser } from "@/lib/auth";
import { decodeCursor, nextCursor } from "@/lib/cursor";
import { intQuery, json, query, route } from "@/lib/handler";
import { feed, toResponses } from "@/services/videos";

/** The public feed, keyset-paginated. */
export const GET = route(async (req) => {
  const viewer = await optionalUser(req);
  const params = query(req);
  const limit = intQuery(params, "limit", 20, 1, 50);
  const cursor = decodeCursor(params.get("cursor"));
  const slice = await feed(cursor, limit);
  const items = await toResponses(slice.videos, viewer?.userId ?? null);
  const rows = slice.videos.map((v) => ({ createdAt: v.created_at, id: v.id }));
  return json({ items, nextCursor: nextCursor(rows, slice.hasNext), hasNext: slice.hasNext });
});
