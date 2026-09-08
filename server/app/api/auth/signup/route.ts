import { signToken } from "@/lib/auth";
import { body, json, route } from "@/lib/handler";
import { SignupRequest } from "@/lib/schemas";
import { signup } from "@/services/auth";
import { userResponse } from "@/services/dto";

export const POST = route(async (req) => {
  const request = await body(req, SignupRequest);
  // The display name starts as the username; the profile screen can change it.
  const user = await signup(request.username, request.email, request.username, request.password);
  return json({ token: await signToken(user.id, user.password_changed_at), user: userResponse(user) }, { status: 201 });
});
