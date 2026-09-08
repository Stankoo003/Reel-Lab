import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/handler";
import { userResponse } from "@/services/dto";
import { requireUserRow } from "@/services/users";

export const GET = route(async (req) => {
  const { userId } = await requireUser(req);
  return json(userResponse(await requireUserRow(userId)));
});
