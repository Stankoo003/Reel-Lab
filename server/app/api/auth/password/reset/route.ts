import { body, json, route } from "@/lib/handler";
import { PasswordResetConfirm } from "@/lib/schemas";
import { reset } from "@/services/passwordReset";

export const POST = route(async (req) => {
  const request = await body(req, PasswordResetConfirm);
  const user = await reset(request.token, request.newPassword);
  return json({ message: `Password changed for ${user.username}. Sign in with it.` });
});
