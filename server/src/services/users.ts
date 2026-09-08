import { sql } from "@/db/client";
import { NotFoundError } from "@/lib/errors";
import { requireRelative } from "@/lib/media";
import { mediaUrl } from "@/lib/media";
import { toIso } from "@/lib/time";
import type { UserRow } from "./dto";
import { followStateOf } from "./follows";

export const USERNAME_TAKEN = "That username is already taken.";
export const EMAIL_TAKEN = "That email is already registered.";

export const SEARCH_LIMIT = 25;
export const SEARCH_LIMIT_MAX = 50;

export async function findAll(): Promise<UserRow[]> {
  return sql<UserRow[]>`select * from users order by created_at asc, id asc`;
}

export async function requireUserRow(id: string): Promise<UserRow> {
  const [row] = await sql<UserRow[]>`select * from users where id = ${id}::uuid`;
  if (!row) throw new NotFoundError("User", id);
  return row;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`select * from users where lower(email) = lower(${email})`;
  return row ?? null;
}

/**
 * Find people by handle or display name. Empty → nothing, leading @ dropped, LIKE wildcards
 * escaped so what was typed matches itself literally; prefix matches rank first.
 */
export async function search(query: string | null, limit: number | null): Promise<UserRow[]> {
  let typed = (query ?? "").trim();
  while (typed.startsWith("@")) typed = typed.slice(1).trim();
  if (!typed) return [];
  const literal = typed.toLowerCase().replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
  const size = Math.min(SEARCH_LIMIT_MAX, Math.max(1, limit ?? SEARCH_LIMIT));
  const anywhere = `%${literal}%`;
  const prefix = `${literal}%`;
  return sql<UserRow[]>`
    select * from users u
    where lower(u.username) like ${anywhere} escape '!'
       or lower(u.display_name) like ${anywhere} escape '!'
    order by
      case when lower(u.username) like ${prefix} escape '!' then 0
           when lower(u.display_name) like ${prefix} escape '!' then 1
           else 2 end,
      lower(u.username)
    limit ${size}`;
}

/** PATCH semantics: undefined leaves a field alone, an empty string clears it. */
export async function updateProfile(
  id: string,
  displayName: string,
  fullName: string | undefined,
  bio: string | undefined,
  avatarPath: string | undefined
): Promise<UserRow> {
  await requireUserRow(id);
  if (avatarPath !== undefined) requireRelative("avatarPath", avatarPath);
  const [row] = await sql<UserRow[]>`
    update users set
      display_name = ${displayName},
      full_name = case when ${fullName === undefined} then full_name
                       when ${fullName?.trim() === ""} then null
                       else ${fullName?.trim() ?? null} end,
      bio = case when ${bio === undefined} then bio
                 when ${bio?.trim() === ""} then null
                 else ${bio ?? null} end,
      avatar_path = case when ${avatarPath === undefined} then avatar_path
                         when ${avatarPath?.trim() === ""} then null
                         else ${avatarPath ?? null} end,
      updated_at = now()
    where id = ${id}::uuid
    returning *`;
  return row;
}

export type Activity = { publishedVideos: number; comments: number; likesReceived: number };

export async function activityOf(id: string): Promise<Activity> {
  const [row] = await sql<{ videos: number; comments: number; likes: number }[]>`
    select
      (select count(*)::int from videos where owner_id = ${id}::uuid and published) as videos,
      (select count(*)::int from comments where author_id = ${id}::uuid) as comments,
      (select count(*)::int from video_likes l join videos v on v.id = l.video_id where v.owner_id = ${id}::uuid) as likes`;
  return { publishedVideos: row.videos, comments: row.comments, likesReceived: row.likes };
}

export type ProfileResponse = {
  id: string; username: string; displayName: string; fullName: string | null; bio: string | null;
  avatarUrl: string | null; createdAt: string;
  activity: { publishedVideos: number; comments: number; likesReceived: number; followers: number; following: number };
  followedByViewer: boolean;
};

export async function profileOf(user: UserRow, viewerId: string | null): Promise<ProfileResponse> {
  const [activity, follow] = await Promise.all([activityOf(user.id), followStateOf(user.id, viewerId)]);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    fullName: user.full_name,
    bio: user.bio,
    avatarUrl: mediaUrl(user.avatar_path),
    createdAt: toIso(user.created_at)!,
    activity: { ...activity, followers: follow.followers, following: follow.following },
    followedByViewer: follow.followedByViewer,
  };
}
