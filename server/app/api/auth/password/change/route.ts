import { requireUser, signToken } from "@/lib/auth";
import { body, json, route } from "@/lib/handler";
import { PasswordChangeRequest } from "@/lib/schemas";
import { changePassword } from "@/services/auth";
import { userResponse } from "@/services/dto";

/** Answers with a NEW token: the change retires every token issued before it, this one included. */
export const POST = route(async (req) => {
  const { userId } = await requireUser(req);
  const request = await body(req, PasswordChangeRequest);
  const user = await changePassword(userId, request.currentPassword, request.newPassword);
  return json({ token: await signToken(user.id, user.password_changed_at), user: userResponse(user) });
});
