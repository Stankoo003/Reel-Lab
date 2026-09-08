/**
 * Threads, and who is allowed to see one. requireParticipant is the single definition of that
 * permission — every path into a conversation goes through it.
 */
import { sql } from "@/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requireNotBlocked } from "./blocks";
import { requireUserRow } from "./users";

export const NOT_A_PARTICIPANT = "That conversation is not yours.";
export const NO_SELF_CONVERSATION = "You cannot message yourself.";

export type ConversationRow = {
  id: string; user_a_id: string; user_b_id: string; last_message_at: string | null; created_at: string;
  a_username: string; a_display_name: string; a_bio: string | null; a_avatar_path: string | null;
  b_username: string; b_display_name: string; b_bio: string | null; b_avatar_path: string | null;
};

const COLUMNS_TEXT = `
  c.id, c.user_a_id, c.user_b_id, c.last_message_at, c.created_at,
  a.username as a_username, a.display_name as a_display_name, a.bio as a_bio, a.avatar_path as a_avatar_path,
  b.username as b_username, b.display_name as b_display_name, b.bio as b_bio, b.avatar_path as b_avatar_path`;

export function includes(c: ConversationRow, userId: string): boolean {
  return c.user_a_id === userId || c.user_b_id === userId;
}

/** The OTHER participant's user fields. */
export function other(c: ConversationRow, viewerId: string) {
  return c.user_a_id === viewerId
    ? { id: c.user_b_id, username: c.b_username, display_name: c.b_display_name, bio: c.b_bio, avatar_path: c.b_avatar_path }
    : { id: c.user_a_id, username: c.a_username, display_name: c.a_display_name, bio: c.a_bio, avatar_path: c.a_avatar_path };
}

/**
 * The canonical pair order is Postgres's uuid ordering, which is byte order — the same as
 * comparing the lowercase hex strings. A numeric comparison would disagree half the time and
 * violate conversations_ordered.
 */
function ordered(x: string, y: string): [string, string] {
  return x.toLowerCase() < y.toLowerCase() ? [x, y] : [y, x];
}

async function findById(id: string): Promise<ConversationRow | null> {
  const [row] = await sql<ConversationRow[]>`
    select ${sql.unsafe(COLUMNS_TEXT)} from conversations c join users a on a.id = c.user_a_id join users b on b.id = c.user_b_id
    where c.id = ${id}::uuid`;
  return row ?? null;
}

export async function openWith(viewerId: string, otherId: string): Promise<ConversationRow> {
  if (viewerId === otherId) throw new ValidationError(NO_SELF_CONVERSATION);
  await requireNotBlocked(viewerId, otherId);
  await requireUserRow(viewerId);
  await requireUserRow(otherId);
  const [smaller, larger] = ordered(viewerId, otherId);
  const [inserted] = await sql<{ id: string }[]>`
    insert into conversations (user_a_id, user_b_id) values (${smaller}::uuid, ${larger}::uuid)
    on conflict (user_a_id, user_b_id) do update set user_a_id = excluded.user_a_id
    returning id`;
  return (await findById(inserted.id))!;
}

export async function listFor(viewerId: string): Promise<ConversationRow[]> {
  return sql<ConversationRow[]>`
    select ${sql.unsafe(COLUMNS_TEXT)} from conversations c join users a on a.id = c.user_a_id join users b on b.id = c.user_b_id
    where c.user_a_id = ${viewerId}::uuid or c.user_b_id = ${viewerId}::uuid
    order by c.last_message_at desc nulls last, c.created_at desc`;
}

/** 404 for an id that does not exist, 403 for one that does and is not yours. */
export async function requireParticipant(conversationId: string, viewerId: string): Promise<ConversationRow> {
  const conversation = await findById(conversationId);
  if (!conversation) throw new NotFoundError("Conversation", conversationId);
  if (!includes(conversation, viewerId)) throw new ForbiddenError(NOT_A_PARTICIPANT);
  return conversation;
}
