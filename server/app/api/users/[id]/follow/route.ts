import { requireUser } from "@/lib/auth";
import { json, route, uuidParam } from "@/lib/handler";
import { follow, unfollow, type FollowState } from "@/services/follows";

const respond = (userId: string, state: FollowState) => json({ userId, ...state });

export const PUT = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  return respond(id, await follow(userId, id));
});

export const DELETE = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  return respond(id, await unfollow(userId, id));
});
