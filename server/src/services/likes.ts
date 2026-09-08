import { sql } from "@/db/client";
import { requireUserRow } from "./users";
import { requireVideo } from "./videos";

export type LikeState = { likeCount: number; likedByViewer: boolean };

async function count(videoId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from video_likes where video_id = ${videoId}::uuid`;
  return row.n;
}

/** Idempotent: ON CONFLICT DO NOTHING absorbs a concurrent like without an error. */
export async function like(videoId: string, userId: string): Promise<LikeState> {
  await requireVideo(videoId);
  await requireUserRow(userId);
  await sql`insert into video_likes (video_id, user_id) values (${videoId}::uuid, ${userId}::uuid)
            on conflict (user_id, video_id) do nothing`;
  return { likeCount: await count(videoId), likedByViewer: true };
}

export async function unlike(videoId: string, userId: string): Promise<LikeState> {
  await requireVideo(videoId);
  await sql`delete from video_likes where video_id = ${videoId}::uuid and user_id = ${userId}::uuid`;
  return { likeCount: await count(videoId), likedByViewer: false };
}

export type LikeSummary = { counts: Map<string, number>; liked: Set<string> };

/** Two queries for a whole page rather than two per row. */
export async function summarise(videoIds: string[], viewerId: string | null): Promise<LikeSummary> {
  const counts = new Map<string, number>();
  const liked = new Set<string>();
  if (videoIds.length === 0) return { counts, liked };
  const rows = await sql<{ video_id: string; n: number }[]>`
    select video_id, count(*)::int as n from video_likes where video_id = any(${videoIds}::uuid[]) group by video_id`;
  for (const r of rows) counts.set(r.video_id, r.n);
  if (viewerId) {
    const mine = await sql<{ video_id: string }[]>`
      select video_id from video_likes where user_id = ${viewerId}::uuid and video_id = any(${videoIds}::uuid[])`;
    for (const r of mine) liked.add(r.video_id);
  }
  return { counts, liked };
}
