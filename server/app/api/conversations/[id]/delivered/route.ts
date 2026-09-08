import { requireUser } from "@/lib/auth";
import { json, route, uuidParam } from "@/lib/handler";
import { markDelivered, receipt } from "@/services/messages";

/** The thread has reached this device — the second tick, without the thread being opened. */
export const POST = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  return json(receipt(await markDelivered(id, userId)));
});
