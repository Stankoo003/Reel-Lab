import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { json, query, route, uuidParam } from "@/lib/handler";
import { parseInstant } from "@/lib/time";
import { messageDto, since } from "@/services/messages";

/** What arrived after a moment — the reconciliation after a gap. */
export const GET = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const after = parseInstant(query(req).get("after") ?? "");
  if (!after) throw new ApiError(400, "after must be a valid Instant");
  return json((await since(id, userId, after)).map((m) => messageDto(m, null)));
});
