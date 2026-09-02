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

export type Profile = components["schemas"]["ProfileResponse"];

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

export type ProfileEdit = { displayName: string; bio?: string | null; avatarPath?: string | null };

export async function updateProfile(userId: string, edit: ProfileEdit): Promise<Profile> {
  const result = await api.PATCH("/api/users/{id}", {
    params: { path: { id: userId } },
    body: {
      displayName: edit.displayName,
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
 * Uses expo-file-system's NATIVE uploader rather than fetch + FormData. Both JS routes
 * fail on RN 0.86: a {uri,name,type} part is rejected as "Unsupported FormDataPart
 * implementation", and a Blob from File.slice() as "Creating blobs from ArrayBuffer ...
 * not supported". The native uploader sends one file per request, which is why the
 * endpoint takes a `kind` instead of both parts at once.
 */
async function uploadOne(
  uri: string,
  kind: "video" | "poster" | "avatar",
  mimeType: string
): Promise<string> {
  // The header is set by hand here. This call does not go through openapi-fetch — it hands
  // the file to the platform's own uploader — so the middleware above never sees it, and
  // uploading is one of the endpoints that requires a token.
  const token = getToken();
  const result = await new FSFile(uri).upload(`${API_BASE_URL.replace(/\/$/, "")}/api/media`, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType,
    parameters: { kind },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (result.status < 200 || result.status >= 300) {
    // The server explains why — wrong type, too large — and that reason is worth showing.
    let detail = `HTTP ${result.status}`;
    try {
      detail = (JSON.parse(result.body) as { detail?: string }).detail ?? detail;
    } catch {
      // non-JSON body; the status is all there is
    }
    throw new Error(`Upload (${kind}) failed: ${detail}`);
  }
  const parsed = JSON.parse(result.body) as { path?: string };
  if (!parsed.path) throw new Error(`Upload (${kind}) returned no path`);
  return parsed.path;
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
