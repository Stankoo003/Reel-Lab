import { requireUser } from "@/lib/auth";
import { body, json, route, uuidParam } from "@/lib/handler";
import { ReportMessageRequest } from "@/lib/schemas";
import { toIso } from "@/lib/time";
import { report } from "@/services/messages";

export const POST = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  const request = await body(req, ReportMessageRequest);
  const row = await report(id, userId, request.reason ?? null);
  return json({ id: row.id, messageId: id, reportedAt: toIso(row.created_at) });
});
