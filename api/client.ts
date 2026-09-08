/**
 * Typed API client.
 *
 * Types come from api/schema.d.ts, which is GENERATED from the backend's own
 * /v3/api-docs by scripts/api/generate-client.sh. Change a DTO on the server,
 * regenerate, and anything that no longer matches fails `npx tsc --noEmit` —
 * rather than failing at runtime on a device.
 *
 * Note: every field is optional in the generated types, because the Java DTOs carry
 * no nullability metadata. Tightening that means annotating the DTOs with
 * @Schema(requiredMode = REQUIRED) on the server, not hand-editing the schema here.
 */
import { File as FSFile } from "expo-file-system";
import { UploadType } from "expo-file-system";
import createClient from "openapi-fetch";
import type { paths, components } from "./schema";
import { API_BASE_URL } from "./config";
import { getToken } from "../src/session";

export const api = createClient<paths>({ baseUrl: API_BASE_URL });

/*
 * The token, on every request that has one.
 *
 * Middleware rather than a per-call argument: the caller's identity is not a parameter of
 * "list videos", and threading it through every function was what let the old code send a
 * user id the server had no way to check. Requests made while signed out simply carry no
 * header — the public read endpoints still answer.
 */
api.use({
  onRequest({ request }) {
    const token = getToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
});

export type VideoResponse = components["schemas"]["VideoResponse"];
export type UserResponse = components["schemas"]["UserResponse"];
export type CommentResponse = components["schemas"]["CommentResponse"];

/**
 * openapi-fetch returns { data, error }; this turns an error into a thrown ValidationError.
 *
 * Always that type, never a plain Error: the server attaches per-field messages to any
 * bean-validation failure, and there is no reason a caller's ability to read them should
 * depend on which of two near-identical helpers the author happened to reach for. It extends
 * Error, so callers that only want a message are unaffected.
 *
 * The parameter is structural rather than openapi-fetch's own type because several endpoints
 * document only their 200, which makes `error` infer as `never`.
 */
function unwrap<T>(result: { data?: T; error?: unknown; response: Response }, what: string): T {
  if (result.error !== undefined || result.data === undefined) {
    const problem = (result.error ?? {}) as { detail?: string; errors?: FieldErrors };
    const detail = problem.detail ?? `HTTP ${result.response.status}`;
    throw new ValidationError(`${what} failed: ${detail}`, problem.errors ?? {});
  }
  return result.data;
}

/** The token, plus who it belongs to. Carries no email — see AuthResponse on the server. */
export type Authenticated = { token: string; user: UserResponse };

function toAuthenticated(result: { token?: string; user?: UserResponse }): Authenticated {
  // Every field in the generated types is optional, because the Java DTOs carry no
  // nullability metadata. A response without these two is not a session, and treating it as
  // one would fail later and further away.
  if (!result.token || !result.user?.id) {
    throw new Error("Sign-in failed: the server returned no session.");
  }
  return { token: result.token, user: result.user };
}

/** Create an account. 409 when the email or username is taken. */
export async function signUp(
  username: string,
  email: string,
  password: string
): Promise<Authenticated> {
  const result = await api.POST("/api/auth/signup", {
    body: { username, email, password },
  });
  return toAuthenticated(unwrap(result, "Sign up"));
}

/** 401 for a wrong password AND for an unknown address — the server does not distinguish. */
export async function signIn(email: string, password: string): Promise<Authenticated> {
  const result = await api.POST("/api/auth/login", { body: { email, password } });
  return toAuthenticated(unwrap(result, "Sign in"));
}

/**
 * Who the stored token belongs to.
 *
 * Called on launch: a token that has expired, or was signed with a secret the server no
 * longer uses, fails here rather than on the first thing the user tries to do.
 */
export async function fetchMe(): Promise<UserResponse> {
  const result = await api.GET("/api/auth/me", {});
  return unwrap(result, "Session check");
}

/**
 * Videos, newest first. publishedOnly=false includes drafts; ownerId narrows to one user.
 *
 * Offset-paginated, unlike the feed — this backs list screens where a stable page number is
 * what the caller wants. Filtering happens in the query: asking for everything and filtering
 * the result showed only whichever of your videos fell in the newest 50 overall.
 */
export async function listVideos(
  options: { publishedOnly?: boolean; ownerId?: string; page?: number; size?: number } = {}
): Promise<VideoResponse[]> {
  const { publishedOnly = true, ownerId, page = 0, size = 50 } = options;
  const result = await api.GET("/api/videos", {
    params: { query: { publishedOnly, ownerId, page, size } },
  });
  return unwrap(result, "List videos").content ?? [];
}

/** One page of the public feed, plus the cursor that reaches the next one. */
export type FeedPage = {
  items: VideoResponse[];
  nextCursor: string | null;
  hasNext: boolean;
};

/**
 * One page of the feed. Cursor-based, not page-numbered: the feed grows while it is read,
 * so an offset would show the reader duplicated or skipped clips as new videos land.
 *
 * Pass back the previous page's `nextCursor` verbatim — it is opaque, and the server is the
 * only thing that builds one. Omit it for the first page.
 *
 * The page is small because a pager consumes one clip per swipe: ten keeps the first paint
 * quick, and `onEndReached` asks for the next page long before the reader arrives.
 */
export async function fetchFeedPage(cursor?: string | null, limit = 10): Promise<FeedPage> {
  const result = await api.GET("/api/videos/feed", {
    // likedByViewer is answered from the token the middleware attaches — signed out, it
    // comes back false rather than being unanswerable. The counts are right either way.
    params: { query: { cursor: cursor ?? undefined, limit } },
  });
  const page = unwrap(result, "Feed");
  return {
    items: page.items ?? [],
    // The generated types mark every field optional — Java DTOs carry no nullability
    // metadata — so normalise here rather than leaking `undefined` into the feed state.
    nextCursor: page.nextCursor ?? null,
    hasNext: page.hasNext ?? false,
  };
}

export type LikeState = { videoId: string; likeCount: number; likedByViewer: boolean };

function toLikeState(raw: components["schemas"]["VideoLikeResponse"]): LikeState {
  return {
    videoId: raw.videoId ?? "",
    likeCount: raw.likeCount ?? 0,
    likedByViewer: raw.likedByViewer ?? false,
  };
}

/**
 * Like a video. Idempotent on the server, so a retry or a replayed request cannot inflate
 * the count — which is what makes it safe for an optimistic UI to fire these on every tap.
 *
 * Returns the authoritative state, which the caller should adopt in place of its guess.
 */
export async function likeVideo(videoId: string): Promise<LikeState> {
  const result = await api.PUT("/api/videos/{id}/like", {
    params: { path: { id: videoId } },
  });
  return toLikeState(unwrap(result, "Like"));
}

/** Remove a like. Also idempotent: unliking what is not liked changes nothing. */
export async function unlikeVideo(videoId: string): Promise<LikeState> {
  const result = await api.DELETE("/api/videos/{id}/like", {
    params: { path: { id: videoId } },
  });
  return toLikeState(unwrap(result, "Unlike"));
}

/** One row of a people list — what search returns. */
export type UserSummary = components["schemas"]["UserSummaryResponse"];

/**
 * Find people by handle or display name.
 *
 * An empty query is answered here rather than on the server: a search box that has been
 * cleared has nothing to ask, and the round trip would only arrive to be discarded.
 */
export async function searchUsers(query: string, signal?: AbortSignal): Promise<UserSummary[]> {
  if (!query.trim()) return [];
  const result = await api.GET("/api/users/search", {
    params: { query: { q: query } },
    // Typing the next letter makes the previous request pointless. Without this, answers
    // race and the list can settle on the results for a prefix the user has moved past.
    signal,
  });
  return unwrap(result, "Search");
}

/**
 * Ask for a reset link.
 *
 * Resolves the same way for an address with an account and one without — that is the
 * server's whole design, and the app must not undo it by treating the two differently. The
 * only failure that reaches here is a rate limit (429) or a malformed address.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const result = await api.POST("/api/auth/password/reset-request", { body: { email } });
  return unwrap(result, "Reset request").message ?? "";
}

/**
 * Change the password while signed in.
 *
 * The answer is a fresh session, not a message: the change retires every token issued
 * before it, this request's included, so the caller has to adopt the new one or find
 * itself signed out by its own success.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<Authenticated> {
  const result = await api.POST("/api/auth/password/change", {
    body: { currentPassword, newPassword },
  });
  const data = unwrap(result, "Change password");
  return { token: data.token ?? "", user: data.user ?? ({} as UserResponse) };
}

/** Spend a reset token. The server answers with a message, not a session — you sign in after. */
export async function resetPassword(token: string, newPassword: string): Promise<string> {
  const result = await api.POST("/api/auth/password/reset", { body: { token, newPassword } });
  return unwrap(result, "Reset password").message ?? "";
}

// --- direct messages ---------------------------------------------------------------

export type Conversation = components["schemas"]["ConversationResponse"];
export type DirectMessage = components["schemas"]["MessageResponseDto"];
export type MessagePage = components["schemas"]["MessagePageResponse"];
/** How far one participant has received and read a thread — what the ticks are drawn from. */
export type Receipt = components["schemas"]["ReceiptResponse"];

export async function fetchConversations(): Promise<Conversation[]> {
  return unwrap(await api.GET("/api/conversations"), "Conversations");
}

/** Start or find the thread with one person. Refused if either has blocked the other. */
export async function openConversation(userId: string): Promise<Conversation> {
  return unwrap(await api.POST("/api/conversations", { body: { userId } }), "Open conversation");
}

/** One page of history, newest first. `cursor` comes from the previous page. */
export async function fetchMessages(
  conversationId: string,
  cursor?: string | null,
  limit = 30
): Promise<MessagePage> {
  const result = await api.GET("/api/conversations/{id}/messages", {
    params: { path: { id: conversationId }, query: { cursor: cursor ?? undefined, limit } },
  });
  return unwrap(result, "Messages");
}

/**
 * What arrived after a moment — the reconnect reconciliation.
 *
 * A socket that was down delivered nothing while it was down, and cannot say so. Rather than
 * trusting the live stream to have been complete, the thread asks what it missed.
 */
export async function fetchMessagesSince(
  conversationId: string,
  after: string
): Promise<DirectMessage[]> {
  const result = await api.GET("/api/conversations/{id}/messages/since", {
    params: { path: { id: conversationId }, query: { after } },
  });
  return unwrap(result, "Missed messages");
}

/** Everything new in a thread since a moment: messages, and how far the other side has read. */
export type ConversationUpdates = { messages: DirectMessage[]; otherReceipt: Receipt | null };

/**
 * What a polling client asks every few seconds. One round trip carries both the messages after
 * `after` and the other participant's receipt — the two things a STOMP topic used to push.
 */
export async function fetchConversationUpdates(
  conversationId: string,
  after: string | null
): Promise<ConversationUpdates> {
  const result = await api.GET("/api/conversations/{id}/updates", {
    params: { path: { id: conversationId }, query: { after: after ?? undefined } },
  });
  const page = unwrap(result, "Updates");
  return { messages: page.messages ?? [], otherReceipt: page.otherReceipt ?? null };
}

/**
 * Send over HTTP.
 *
 * The queue retries through here rather than over the socket: an HTTP call has a status code,
 * so "did it arrive" is answerable. A frame written into a socket that is quietly dead is not.
 */
export async function sendMessage(
  conversationId: string,
  body: string,
  clientId: string,
  /** A published clip to share into the thread. The body may then be empty. */
  videoId?: string
): Promise<DirectMessage> {
  const result = await api.POST("/api/conversations/{id}/messages", {
    params: { path: { id: conversationId } },
    body: { body, clientId, videoId },
  });
  return unwrap(result, "Send");
}

/** A clip as it sits inside a message: enough to draw the card and to play it. */
export type SharedVideo = components["schemas"]["SharedVideoDto"];

/** Opening a thread reads it to the end. */
export async function markConversationRead(conversationId: string): Promise<void> {
  await api.POST("/api/conversations/{id}/read", {
    params: { path: { id: conversationId } },
  });
}

/**
 * The thread reached this device without being opened — the second tick for the sender.
 *
 * Opening the thread reads it, and reading implies delivery, so the thread screen never
 * calls this; the inbox does, for everything it has just listed.
 */
export async function markConversationDelivered(conversationId: string): Promise<Receipt> {
  const result = await api.POST("/api/conversations/{id}/delivered", {
    params: { path: { id: conversationId } },
  });
  return unwrap(result, "Delivered");
}

/** Every thread at once. Returns only the receipts that moved. */
export async function markAllConversationsDelivered(): Promise<Receipt[]> {
  return unwrap(await api.POST("/api/conversations/delivered"), "Delivered");
}

/**
 * These answer 204, so there is no body for `unwrap` to hand back — its "no data means it
 * failed" rule would turn every success into an error. The status is the whole answer.
 */
function throwIfFailed(result: { error?: unknown; response: Response }, what: string): void {
  if (result.error !== undefined || !result.response.ok) {
    const problem = (result.error ?? {}) as { detail?: string; errors?: FieldErrors };
    const detail = problem.detail ?? `HTTP ${result.response.status}`;
    throw new ValidationError(`${what} failed: ${detail}`, problem.errors ?? {});
  }
}

export async function blockUser(userId: string): Promise<void> {
  throwIfFailed(
    await api.PUT("/api/users/{id}/block", { params: { path: { id: userId } } }), "Block");
}

export async function unblockUser(userId: string): Promise<void> {
  throwIfFailed(
    await api.DELETE("/api/users/{id}/block", { params: { path: { id: userId } } }), "Unblock");
}

export async function reportMessage(messageId: string, reason?: string): Promise<void> {
  throwIfFailed(await api.POST("/api/messages/{id}/report", {
    params: { path: { id: messageId } },
    body: { reason },
  }), "Report");
}

export type Profile = components["schemas"]["ProfileResponse"];

/** The state of one user's follows after a change — what a Follow button settles on. */
export type FollowState = components["schemas"]["FollowResponse"];

/**
 * Follow and unfollow.
 *
 * PUT and DELETE, and idempotent both ways, exactly like a like: the button flips before
 * the server has answered, so it has to be safe to press twice or replay on a retry.
 */
export async function followUser(userId: string): Promise<FollowState> {
  const result = await api.PUT("/api/users/{id}/follow", { params: { path: { id: userId } } });
  return unwrap(result, "Follow");
}

export async function unfollowUser(userId: string): Promise<FollowState> {
  const result = await api.DELETE("/api/users/{id}/follow", { params: { path: { id: userId } } });
  return unwrap(result, "Unfollow");
}

export async function getProfile(userId: string): Promise<Profile> {
  const result = await api.GET("/api/users/{id}/profile", { params: { path: { id: userId } } });
  return unwrap(result, "Profile");
}

/**
 * Field-keyed validation messages from a 400, e.g. `{ displayName: "cannot be empty" }`.
 *
 * The server puts these in a ProblemDetail extension member so a form can mark the input
 * that caused each one, rather than printing a single sentence above everything.
 */
export type FieldErrors = Record<string, string>;

export class ValidationError extends Error {
  readonly fields: FieldErrors;

  constructor(message: string, fields: FieldErrors) {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export type ProfileEdit = {
  displayName: string;
  /** The person's real name. "" clears it; undefined leaves it alone. */
  fullName?: string | null;
  bio?: string | null;
  avatarPath?: string | null;
};

export async function updateProfile(userId: string, edit: ProfileEdit): Promise<Profile> {
  const result = await api.PATCH("/api/users/{id}", {
    params: { path: { id: userId } },
    body: {
      displayName: edit.displayName,
      // `?? undefined` maps null to "leave it alone" — an empty STRING is what clears a
      // field, and the two must not collapse into each other on the way out.
      fullName: edit.fullName ?? undefined,
      bio: edit.bio ?? undefined,
      avatarPath: edit.avatarPath ?? undefined,
    },
  });
  return unwrap(result, "Save profile");
}

/**
 * Upload an avatar and return its RELATIVE path, to be sent on to updateProfile.
 *
 * The server is what validates this — type by magic bytes and size against its own cap —
 * so anything checked here is a courtesy to save a round trip, never the guarantee.
 */
export async function uploadAvatar(uri: string): Promise<string> {
  const mimeType = uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return uploadOne(uri, "avatar", mimeType);
}

/** One page of a comment thread, oldest first, with replies nested under each root. */
export type CommentPage = {
  items: CommentResponse[];
  nextCursor: string | null;
  hasNext: boolean;
};

export async function fetchCommentPage(
  videoId: string,
  cursor?: string | null,
  limit = 20
): Promise<CommentPage> {
  const result = await api.GET("/api/videos/{videoId}/comments", {
    params: { path: { videoId }, query: { cursor: cursor ?? undefined, limit } },
  });
  const page = unwrap(result, "Comments");
  return {
    items: page.items ?? [],
    nextCursor: page.nextCursor ?? null,
    hasNext: page.hasNext ?? false,
  };
}

/**
 * Post a comment, or a reply when parentId is given.
 *
 * A 409 here is expected, not exceptional: one top-level comment and one reply per user
 * per video is a rule the server enforces with a unique constraint. Callers should show
 * `error.message` — it says to edit the existing comment instead.
 */
export async function addComment(
  videoId: string,
  body: string,
  parentId?: string | null
): Promise<CommentResponse> {
  const result = await api.POST("/api/videos/{videoId}/comments", {
    params: { path: { videoId } },
    body: { body, parentId: parentId ?? undefined },
  });
  return unwrap(result, "Add comment");
}

/** Edit an existing comment. Never counts as a new one, so it cannot hit the 409. */
export async function editComment(id: string, body: string): Promise<CommentResponse> {
  const result = await api.PATCH("/api/comments/{id}", { params: { path: { id } }, body: { body } });
  return unwrap(result, "Edit comment");
}

export type Health = { status: string; components?: Record<string, { status?: string }> };

/**
 * Backend health. In the contract because springdoc.show-actuator is on, so this is
 * typed like every other call rather than a stray fetch.
 */
export async function getHealth(): Promise<Health> {
  const result = await api.GET("/actuator/health", {});
  return unwrap(result, "Health") as Health;
}

/**
 * Upload one file and get back its relative path.
 *
 * Two steps. The server does not accept the bytes itself — a serverless function takes a few
 * megabytes of body and a clip is hundreds — so it is asked where to put them: POST /api/media
 * answers with the path it chose and a signed PUT URL (Cloudflare R2 deployed, the API's own
 * disk in development). The bytes then go straight there with expo-file-system's NATIVE
 * uploader, which is the one upload route that works on RN 0.86 — see uploadMedia's history.
 * The path is what POST /api/videos and PATCH /api/users/{id} take; they verify what landed.
 */
async function uploadOne(
  uri: string,
  kind: "video" | "poster" | "avatar",
  mimeType: string
): Promise<string> {
  const file = new FSFile(uri);
  const size = file.size ?? 0;
  const presigned = await api.POST("/api/media", {
    params: { query: { kind } },
    body: { contentType: mimeType, size },
  });
  const target = unwrap(presigned, `Upload (${kind})`);
  if (!target.path || !target.uploadUrl) throw new Error(`Upload (${kind}) returned no destination`);

  const result = await file.upload(target.uploadUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    mimeType,
    headers: target.headers ?? { "Content-Type": mimeType },
  });
  if (result.status < 200 || result.status >= 300) {
    // Storage explains why — a signature that expired, a size that did not match.
    let detail = `HTTP ${result.status}`;
    try {
      detail = (JSON.parse(result.body) as { detail?: string }).detail ?? detail;
    } catch {
      // non-JSON body (R2 answers with XML); the status is all there is
    }
    throw new Error(`Upload (${kind}) failed: ${detail}`);
  }
  return target.path;
}

/** Upload the exported video and its poster; returns the relative paths. */
export async function uploadMedia(videoUri: string, posterUri?: string | null) {
  const manifestPath = await uploadOne(videoUri, "video", "video/mp4");
  const posterPath = posterUri ? await uploadOne(posterUri, "poster", "image/jpeg") : null;
  return { manifestPath, posterPath };
}

export type NewVideo = {
  title: string;
  description?: string;
  durationSeconds: number;
  manifestPath: string;
  posterPath?: string | null;
};

export async function createVideo(input: NewVideo): Promise<VideoResponse> {
  const result = await api.POST("/api/videos", {
    body: {
      title: input.title,
      description: input.description,
      durationSeconds: input.durationSeconds,
      manifestPath: input.manifestPath,
      posterPath: input.posterPath ?? undefined,
    },
  });
  return unwrap(result, "Create video");
}

export async function setVideoPublished(id: string, published: boolean): Promise<VideoResponse> {
  const result = await api.PATCH("/api/videos/{id}", {
    params: { path: { id } },
    body: { published },
  });
  return unwrap(result, "Publish video");
}
