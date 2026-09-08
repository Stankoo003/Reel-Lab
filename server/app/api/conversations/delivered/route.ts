import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/handler";
import { markAllDelivered, receipt } from "@/services/messages";

/** Every thread at once — what the inbox sends after it has loaded the list. */
export const POST = route(async (req) => {
  const { userId } = await requireUser(req);
  return json((await markAllDelivered(userId)).map(receipt));
});
