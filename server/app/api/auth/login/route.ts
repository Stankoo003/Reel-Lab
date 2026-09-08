import { signToken } from "@/lib/auth";
import { body, json, route } from "@/lib/handler";
import { LoginRequest } from "@/lib/schemas";
import { authenticate } from "@/services/auth";
import { userResponse } from "@/services/dto";

export const POST = route(async (req) => {
  const request = await body(req, LoginRequest);
  const user = await authenticate(request.email, request.password);
  return json({ token: await signToken(user.id, user.password_changed_at), user: userResponse(user) });
});
