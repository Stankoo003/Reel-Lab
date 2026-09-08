import { requireUser } from "@/lib/auth";
import { noContent, route, uuidParam } from "@/lib/handler";
import { block, unblock } from "@/services/blocks";

export const PUT = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  await block(userId, id);
  return noContent();
});

export const DELETE = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  await unblock(userId, id);
  return noContent();
});
