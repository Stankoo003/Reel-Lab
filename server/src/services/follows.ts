import { sql } from "@/db/client";
import { ValidationError } from "@/lib/errors";
import { requireUserRow } from "./users";

export const CANNOT_FOLLOW_SELF = "You cannot follow yourself.";

export type FollowState = { followers: number; following: number; followedByViewer: boolean };

async function state(userId: string, following: boolean): Promise<FollowState> {
  const [row] = await sql<{ followers: number; following: number }[]>`
    select
      (select count(*)::int from user_follows where followee_id = ${userId}::uuid) as followers,
      (select count(*)::int from user_follows where follower_id = ${userId}::uuid) as following`;
  return { followers: row.followers, following: row.following, followedByViewer: following };
}

/** Idempotent, like a like: following someone you already follow succeeds and changes nothing. */
export async function follow(followerId: string, followeeId: string): Promise<FollowState> {
  if (followerId === followeeId) throw new ValidationError(CANNOT_FOLLOW_SELF);
  await requireUserRow(followerId);
  await requireUserRow(followeeId);
  await sql`insert into user_follows (follower_id, followee_id) values (${followerId}::uuid, ${followeeId}::uuid)
            on conflict (follower_id, followee_id) do nothing`;
  return state(followeeId, true);
}

export async function unfollow(followerId: string, followeeId: string): Promise<FollowState> {
  await requireUserRow(followeeId);
  await sql`delete from user_follows where follower_id = ${followerId}::uuid and followee_id = ${followeeId}::uuid`;
  return state(followeeId, false);
}

/** Counts for one user and whether the viewer follows them — false signed out or on yourself. */
export async function followStateOf(userId: string, viewerId: string | null): Promise<FollowState> {
  let following = false;
  if (viewerId && viewerId !== userId) {
    const [row] = await sql<{ exists: boolean }[]>`
      select exists (select 1 from user_follows where follower_id = ${viewerId}::uuid and followee_id = ${userId}::uuid)`;
    following = row.exists;
  }
  return state(userId, following);
}

/** Which of these users the viewer follows — one query for a whole page. */
export async function followedAmong(userIds: string[], viewerId: string | null): Promise<Set<string>> {
  if (!viewerId || userIds.length === 0) return new Set();
  const rows = await sql<{ followee_id: string }[]>`
    select followee_id from user_follows where follower_id = ${viewerId}::uuid and followee_id = any(${userIds}::uuid[])`;
  return new Set(rows.map((r) => r.followee_id));
}
