import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/handler";
import { blockedBy } from "@/services/blocks";
import { userSummary } from "@/services/dto";

/** Who you have blocked. Never who has blocked you. */
export const GET = route(async (req) => {
  const { userId } = await requireUser(req);
  return json((await blockedBy(userId)).map(userSummary));
});
