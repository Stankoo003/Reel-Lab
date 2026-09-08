import { requireUser } from "@/lib/auth";
import { json, route, uuidParam } from "@/lib/handler";
import { like, unlike } from "@/services/likes";

export const PUT = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  return json({ videoId: id, ...(await like(id, userId)) });
});

export const DELETE = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  return json({ videoId: id, ...(await unlike(id, userId)) });
});
