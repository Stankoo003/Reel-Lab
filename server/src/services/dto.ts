/** Row shapes and the response DTOs built from them. Never an email, never a hash. */
import { mediaUrl } from "@/lib/media";
import { toIso } from "@/lib/time";

export type UserRow = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  full_name: string | null;
  bio: string | null;
  avatar_path: string | null;
  password_hash: string;
  password_changed_at: string;
  created_at: string;
  updated_at: string;
};

export type UserResponse = { id: string; username: string; displayName: string; avatarUrl: string | null; createdAt: string };
export type UserSummaryResponse = { id: string; username: string; displayName: string; bio: string | null; avatarUrl: string | null };

export function userResponse(u: Pick<UserRow, "id" | "username" | "display_name" | "avatar_path" | "created_at">): UserResponse {
  return { id: u.id, username: u.username, displayName: u.display_name, avatarUrl: mediaUrl(u.avatar_path), createdAt: toIso(u.created_at)! };
}

export function userSummary(u: Pick<UserRow, "id" | "username" | "display_name" | "bio" | "avatar_path">): UserSummaryResponse {
  return { id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, avatarUrl: mediaUrl(u.avatar_path) };
}

/** A video joined with its owner, the columns prefixed so one row carries both. */
export type VideoRow = {
  id: string;
  title: string;
  description: string | null;
  duration_seconds: number;
  manifest_path: string;
  poster_path: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
  owner_id: string;
  owner_username: string;
  owner_display_name: string;
  owner_bio: string | null;
  owner_avatar_path: string | null;
  owner_created_at: string;
};

export function ownerOf(v: VideoRow) {
  return { id: v.owner_id, username: v.owner_username, display_name: v.owner_display_name, bio: v.owner_bio,
    avatar_path: v.owner_avatar_path, created_at: v.owner_created_at };
}

export type VideoResponse = {
  id: string; owner: UserResponse; title: string; description: string | null; durationSeconds: number;
  manifestUrl: string | null; posterUrl: string | null; published: boolean; likeCount: number;
  likedByViewer: boolean; ownerFollowedByViewer: boolean; createdAt: string; updatedAt: string;
};

export function videoResponse(v: VideoRow, likeCount: number, likedByViewer: boolean, ownerFollowedByViewer: boolean): VideoResponse {
  return {
    id: v.id,
    owner: userResponse(ownerOf(v)),
    title: v.title,
    description: v.description,
    durationSeconds: v.duration_seconds,
    manifestUrl: mediaUrl(v.manifest_path),
    posterUrl: mediaUrl(v.poster_path),
    published: v.published,
    likeCount,
    likedByViewer,
    ownerFollowedByViewer,
    createdAt: toIso(v.created_at)!,
    updatedAt: toIso(v.updated_at)!,
  };
}

/** The select list every video query shares. */
export const VIDEO_COLUMNS = `
  v.id, v.title, v.description, v.duration_seconds, v.manifest_path, v.poster_path, v.published,
  v.created_at, v.updated_at,
  u.id as owner_id, u.username as owner_username, u.display_name as owner_display_name,
  u.bio as owner_bio, u.avatar_path as owner_avatar_path, u.created_at as owner_created_at`;
