/**
 * Request bodies. Messages mirror the bean-validation defaults Spring produced so a form that
 * maps them to fields sees the same text.
 */
import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const notBlank = (message = "must not be blank") =>
  z.string({ error: message }).refine((s) => s.trim().length > 0, { message });

const size = (max: number, message = `size must be between 0 and ${max}`) => z.string().max(max, { message });
export const uuid = (message = "must be a valid UUID") => z.string().regex(UUID, { message }).transform((s) => s.toLowerCase());
const email = (message = "must be a well-formed email address") => z.string().regex(/^[^@\s]+@[^@\s]+$/, { message });

export const SignupRequest = z.object({
  username: notBlank().pipe(size(50)),
  email: notBlank().pipe(email()).pipe(size(255)),
  password: notBlank().pipe(z.string().min(8, { message: "size must be between 8 and 200" }).max(200, { message: "size must be between 8 and 200" })),
});

export const LoginRequest = z.object({ email: notBlank(), password: notBlank() });

export const PasswordChangeRequest = z.object({
  currentPassword: notBlank("Enter your current password"),
  newPassword: notBlank("Choose a new password"),
});

export const PasswordResetRequest = z.object({
  email: notBlank("Enter your email address").pipe(email("That does not look like an email address")),
});

export const PasswordResetConfirm = z.object({
  token: notBlank("The reset link is missing its token"),
  newPassword: notBlank("Choose a new password"),
});

export const UpdateProfileRequest = z.object({
  displayName: notBlank("Display name cannot be empty").pipe(size(100, "Display name must be 100 characters or fewer")),
  fullName: size(100, "Name must be 100 characters or fewer").nullish(),
  bio: size(500, "Bio must be 500 characters or fewer").nullish(),
  avatarPath: size(500).regex(/^(?![a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(?!\/).*$/, { message: "Avatar must be a relative path, not a URL" }).nullish(),
});

export const CreateVideoRequest = z.object({
  title: notBlank().pipe(size(200)),
  description: z.string().nullish(),
  durationSeconds: z.number({ error: "must be greater than 0" }).int().positive({ message: "must be greater than 0" }),
  manifestPath: notBlank().pipe(size(500)),
  posterPath: size(500).nullish(),
});

export const UpdateVideoPublishedRequest = z.object({ published: z.boolean({ error: "must not be null" }) });

export const CreateCommentRequest = z.object({
  parentId: uuid().nullish(),
  body: notBlank().pipe(size(2000)),
});

export const UpdateCommentRequest = z.object({ body: notBlank().pipe(size(2000)) });

export const OpenConversationRequest = z.object({ userId: uuid("must not be null") });

export const SendMessageRequest = z.object({
  body: size(4000, "A message can be at most 4000 characters").nullish(),
  clientId: z.string().nullish(),
  videoId: uuid().nullish(),
});

export const ReportMessageRequest = z.object({ reason: size(500).nullish() });

export const PresignRequest = z.object({
  contentType: z.string().nullish(),
  size: z.number().int(),
});
