import { optionalUser, requireUser } from "@/lib/auth";
import { requireSelf } from "@/lib/errors";
import { body, json, route, uuidParam } from "@/lib/handler";
import { UpdateProfileRequest } from "@/lib/schemas";
import { userResponse } from "@/services/dto";
import { discardAvatar, verifyUploaded } from "@/services/media";
import { profileOf, requireUserRow, updateProfile } from "@/services/users";

export const GET = route(async (req, ctx) => {
  await optionalUser(req);
  return json(userResponse(await requireUserRow(await uuidParam(ctx, "id"))));
});

/** Edit a profile. Yours only — the id in the path must be the id in the token. */
export const PATCH = route(async (req, ctx) => {
  const id = await uuidParam(ctx, "id");
  const { userId } = await requireUser(req);
  requireSelf(userId, id, "profile");
  const request = await body(req, UpdateProfileRequest);
  if (request.avatarPath) await verifyUploaded("avatar", request.avatarPath);
  const before = await requireUserRow(id);
  const user = await updateProfile(id, request.displayName, request.fullName ?? undefined, request.bio ?? undefined, request.avatarPath ?? undefined);
  // One avatar per user: the file the new one replaced (or a cleared one) is removed.
  if (request.avatarPath !== undefined && before.avatar_path && before.avatar_path !== user.avatar_path) {
    await discardAvatar(before.avatar_path);
  }
  return json(await profileOf(user, userId));
});
