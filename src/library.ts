// The server-backed clip library, on top of the generated typed client.
//
// Clips keep the CDN URL the SERVER composed from its own MEDIA_CDN_BASE_URL and hand
// it straight to expo-video — playback streams from the CDN rather than a local copy.
// Download is deferred to export, where a local file is unavoidable.
import { File, Paths } from "expo-file-system";
import { fetchFeedPage as fetchFeedPageRaw, listVideos } from "../api/client";
import { currentUserId } from "./session";
import { mmss } from "./clips";
import { toPath } from "./assets";
import type { Clip } from "./types";
import type { VideoResponse } from "../api/client";

// The generated schema marks id, title and manifestUrl optional — the server always sends
// them, but nothing in the contract says so. Falling back keeps the shape whole rather than
// letting `undefined` reach a list key or a video source.
function toClip(v: VideoResponse): Clip {
  return {
    id: v.id ?? "",
    name: v.title ?? "untitled",
    uri: v.manifestUrl ?? "",
    path: null,
    origin: "library",
    remote: true,
    published: v.published,
    ownerId: v.owner?.id,
    ownerName: v.owner?.displayName,
    duration: v.durationSeconds ?? 0,
    durationLabel: mmss(v.durationSeconds ?? 0),
    bytes: 0,
    when: v.published ? "published" : "draft",
    // expo-image takes a remote URL directly.
    thumb: v.posterUrl ? { uri: v.posterUrl } : null,
    likeCount: v.likeCount ?? 0,
    likedByViewer: v.likedByViewer ?? false,
  };
}

/**
 * Does this clip exist on the server?
 *
 * Everything social hangs off that: comments, likes, and anything later. A locally recorded
 * or imported clip has never been uploaded, so there is no row to attach to and nobody else
 * who could ever see it. Callers use this to decide whether to render the affordance at all
 * — the rule is "no affordance", not "an affordance that fails".
 *
 * One predicate rather than the identical canLike/canComment pair that used to live in two
 * modules, each documented as "the same rule as the other one".
 */
export function isServerBacked(clip: Clip): boolean {
  return clip.origin === "library" && Boolean(clip.id);
}

export type FeedPage = {
  clips: Clip[];
  /** Feed this back to get the page after this one; null when there is none. */
  nextCursor: string | null;
  hasNext: boolean;
};

/**
 * One page of the feed. The feed is unbounded, so it is read a page at a time and never
 * as a single list — see fetchFeedPage in api/client.ts for why the cursor is opaque.
 */
export async function fetchFeedPage(cursor?: string | null): Promise<FeedPage> {
  const page = await fetchFeedPageRaw(cursor);
  return { clips: page.items.map(toClip), nextCursor: page.nextCursor, hasNext: page.hasNext };
}

/** Everything the acting user owns, drafts included — scoped by the server, not filtered here. */
export async function fetchMyVideos(): Promise<Clip[]> {
  const me = currentUserId();
  // Signed out there is no "mine" to list. An unfiltered call would quietly return
  // everyone's videos under a heading that says they are yours.
  if (!me) return [];
  return (await listVideos({ ownerId: me, publishedOnly: false })).map(toClip);
}

/**
 * May the acting user edit this clip?
 *
 * Editing exports a new file from the source, so it is only offered on clips the user
 * owns. Locally recorded or imported clips carry no owner — they were captured on this
 * device, so they are the user's by definition.
 *
 * This mirrors the server, which now enforces the same rule: editing exports a new video
 * owned by the caller in the token, and publishing or deleting someone else's is a 403.
 * Checking here keeps the app from offering an action it knows will be refused.
 */
export function canEdit(clip: Clip): boolean {
  if (clip.origin !== "library") return true;
  return clip.ownerId === currentUserId();
}

/**
 * Ensure a clip is backed by a local file, downloading it if remote.
 * Only needed for export — FFmpeg takes a filesystem path, not a URL.
 */
export async function materialiseForExport(clip: Clip): Promise<Clip> {
  if (!clip.remote) return clip;
  const ext = (clip.uri.split("?")[0].match(/\.(\w{2,4})$/)?.[1] ?? "mp4").toLowerCase();
  const dest = new File(Paths.cache, `library-${clip.id}.${ext}`);
  if (!dest.exists) {
    await File.downloadFileAsync(clip.uri, dest);
  }
  return { ...clip, uri: dest.uri, path: toPath(dest.uri), remote: false };
}
