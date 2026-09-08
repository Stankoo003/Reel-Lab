import { sql } from "@/db/client";
import { ConflictError, NotFoundError, requireSelf, ValidationError } from "@/lib/errors";
import { toIso } from "@/lib/time";
import { userResponse, type UserResponse } from "./dto";
import { requireUserRow } from "./users";
import { requireVideo } from "./videos";

export const ALREADY_COMMENTED = "You have already commented on this video. Edit your existing comment instead.";
export const ALREADY_REPLIED = "You have already replied to this comment. Edit your existing reply instead.";

export type CommentRow = {
  id: string; video_id: string; parent_id: string | null; body: string; created_at: string; updated_at: string;
  author_id: string; author_username: string; author_display_name: string; author_avatar_path: string | null; author_created_at: string;
};

const COLUMNS_TEXT = `
  c.id, c.video_id, c.parent_id, c.body, c.created_at, c.updated_at,
  u.id as author_id, u.username as author_username, u.display_name as author_display_name,
  u.avatar_path as author_avatar_path, u.created_at as author_created_at`;

export type CommentResponse = { id: string; author: UserResponse; body: string; createdAt: string; updatedAt: string; replies: CommentResponse[] };

export function commentResponse(c: CommentRow, replies: CommentRow[]): CommentResponse {
  return {
    id: c.id,
    author: userResponse({ id: c.author_id, username: c.author_username, display_name: c.author_display_name,
      avatar_path: c.author_avatar_path, created_at: c.author_created_at }),
    body: c.body,
    createdAt: toIso(c.created_at)!,
    updatedAt: toIso(c.updated_at)!,
    replies: replies.map((r) => commentResponse(r, [])),
  };
}

async function requireComment(id: string): Promise<CommentRow> {
  const [row] = await sql<CommentRow[]>`
    select ${sql.unsafe(COLUMNS_TEXT)} from comments c join users u on u.id = c.author_id where c.id = ${id}::uuid`;
  if (!row) throw new NotFoundError("Comment", id);
  return row;
}

async function repliesTo(rootIds: string[]): Promise<Map<string, CommentRow[]>> {
  const grouped = new Map<string, CommentRow[]>();
  if (rootIds.length === 0) return grouped;
  const rows = await sql<CommentRow[]>`
    select ${sql.unsafe(COLUMNS_TEXT)} from comments c join users u on u.id = c.author_id
    where c.parent_id = any(${rootIds}::uuid[]) order by c.created_at asc, c.id asc`;
  for (const r of rows) {
    const list = grouped.get(r.parent_id!) ?? [];
    list.push(r);
    grouped.set(r.parent_id!, list);
  }
  return grouped;
}

export type Thread = { roots: CommentRow[]; replies: Map<string, CommentRow[]>; hasNext: boolean };

/** Roots oldest first, keyset-paginated, each with all of its direct replies. Two queries per page. */
export async function threadFor(videoId: string, cursor: { createdAt: string; id: string } | null, limit: number): Promise<Thread> {
  await requireVideo(videoId);
  const rows = cursor
    ? await sql<CommentRow[]>`
        select ${sql.unsafe(COLUMNS_TEXT)} from comments c join users u on u.id = c.author_id
        where c.video_id = ${videoId}::uuid and c.parent_id is null
          and (c.created_at > ${cursor.createdAt}::timestamptz
            or (c.created_at = ${cursor.createdAt}::timestamptz and c.id > ${cursor.id}::uuid))
        order by c.created_at asc, c.id asc limit ${limit + 1}`
    : await sql<CommentRow[]>`
        select ${sql.unsafe(COLUMNS_TEXT)} from comments c join users u on u.id = c.author_id
        where c.video_id = ${videoId}::uuid and c.parent_id is null
        order by c.created_at asc, c.id asc limit ${limit + 1}`;
  const hasNext = rows.length > limit;
  const roots = hasNext ? rows.slice(0, limit) : rows;
  return { roots, replies: await repliesTo(roots.map((r) => r.id)), hasNext };
}

export async function add(videoId: string, authorId: string, parentId: string | null, body: string): Promise<CommentRow> {
  await requireVideo(videoId);
  await requireUserRow(authorId);
  if (parentId) {
    const parent = await requireComment(parentId);
    if (parent.video_id !== videoId) throw new ValidationError("Parent comment belongs to a different video");
    if (parent.parent_id) throw new ValidationError("Replies are limited to one level");
    const [dup] = await sql<{ exists: boolean }[]>`select exists (select 1 from comments
      where video_id = ${videoId}::uuid and author_id = ${authorId}::uuid and parent_id = ${parentId}::uuid)`;
    if (dup.exists) throw new ConflictError(ALREADY_REPLIED);
  } else {
    const [dup] = await sql<{ exists: boolean }[]>`select exists (select 1 from comments
      where video_id = ${videoId}::uuid and author_id = ${authorId}::uuid and parent_id is null)`;
    if (dup.exists) throw new ConflictError(ALREADY_COMMENTED);
  }
  // created_at and updated_at share one default expression, so they are identical until an edit.
  const [inserted] = await sql<{ id: string }[]>`
    insert into comments (video_id, author_id, parent_id, body)
    values (${videoId}::uuid, ${authorId}::uuid, ${parentId}::uuid, ${body}) returning id`;
  return requireComment(inserted.id);
}

export async function edit(id: string, body: string, actor: string): Promise<{ comment: CommentRow; replies: CommentRow[] }> {
  const existing = await requireComment(id);
  requireSelf(actor, existing.author_id, "comment");
  await sql`update comments set body = ${body}, updated_at = now() where id = ${id}::uuid`;
  const comment = await requireComment(id);
  const replies = comment.parent_id ? [] : (await repliesTo([id])).get(id) ?? [];
  return { comment, replies };
}

export async function remove(id: string, actor: string): Promise<void> {
  const existing = await requireComment(id);
  requireSelf(actor, existing.author_id, "comment");
  await sql`delete from comments where id = ${id}::uuid`;
}
