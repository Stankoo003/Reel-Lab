import { body, clientIp, json, route } from "@/lib/handler";
import { PasswordResetRequest } from "@/lib/schemas";
import { REQUEST_ACCEPTED, requestReset } from "@/services/passwordReset";

/** Always the same answer, after the same time, whether or not the address has an account. */
export const POST = route(async (req) => {
  const request = await body(req, PasswordResetRequest);
  await requestReset(request.email, clientIp(req));
  return json({ message: REQUEST_ACCEPTED });
});
