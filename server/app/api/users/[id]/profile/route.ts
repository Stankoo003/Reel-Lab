import { optionalUser } from "@/lib/auth";
import { json, route, uuidParam } from "@/lib/handler";
import { profileOf, requireUserRow } from "@/services/users";

/** Public; the token, when sent, only answers followedByViewer. */
export const GET = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const viewer = await optionalUser(req);
  return json(await profileOf(await requireUserRow(id), viewer?.userId ?? null));
});
