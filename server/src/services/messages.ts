/** Sending, reading and paging messages, plus the two receipt watermarks per participant. */
import { sql } from "@/db/client";
import { config } from "@/lib/config";
import { ForbiddenError, NotFoundError, TooManyRequestsError, ValidationError } from "@/lib/errors";
import { mediaUrl } from "@/lib/media";
import { tryAcquire } from "@/lib/rateLimit";
import { isEpoch, toIso } from "@/lib/time";
import { isBlockedBetween, requireNotBlocked } from "./blocks";
import { type ConversationRow, includes, listFor, NOT_A_PARTICIPANT, other, requireParticipant } from "./conversations";
import { userSummary, type UserSummaryResponse } from "./dto";
import { findShareable } from "./videos";

export const EMPTY_BODY = "A message needs some text.";
export const TOO_LONG = "A message can be at most 4000 characters.";
export const RATE_LIMITED = "You are sending messages too quickly.";
export const VIDEO_NOT_SHAREABLE = "That video cannot be shared.";
export const MAX_BODY = 4000;

export type MessageRow = {
  id: string; conversation_id: string; sender_id: string; body: string; had_video: boolean; created_at: string;
  video_id: string | null; video_title: string | null; video_duration_seconds: number | null;
  video_manifest_path: string | null; video_poster_path: string | null; video_published: boolean | null;
  owner_id: string | null; owner_username: string | null; owner_display_name: string | null;
  owner_bio: string | null; owner_avatar_path: string | null;
};

const COLUMNS_TEXT = `
  m.id, m.conversation_id, m.sender_id, m.body, m.had_video, m.created_at,
  v.id as video_id, v.title as video_title, v.duration_seconds as video_duration_seconds,
  v.manifest_path as video_manifest_path, v.poster_path as video_poster_path, v.published as video_published,
  o.id as owner_id, o.username as owner_username, o.display_name as owner_display_name,
  o.bio as owner_bio, o.avatar_path as owner_avatar_path`;
const FROM_TEXT = `from messages m left join videos v on v.id = m.video_id left join users o on o.id = v.owner_id`;

export type SharedVideoDto = { id: string; title: string; durationSeconds: number; manifestUrl: string | null; posterUrl: string | null; owner: UserSummaryResponse };
export type MessageResponseDto = {
  id: string; conversationId: string; senderId: string; body: string; clientId: string | null;
  video: SharedVideoDto | null; videoRemoved: boolean; createdAt: string;
};

export function messageDto(m: MessageRow, clientId: string | null): MessageResponseDto {
  const video: SharedVideoDto | null = m.video_id
    ? {
        id: m.video_id, title: m.video_title!, durationSeconds: m.video_duration_seconds!,
        manifestUrl: mediaUrl(m.video_manifest_path), posterUrl: mediaUrl(m.video_poster_path),
        owner: userSummary({ id: m.owner_id!, username: m.owner_username!, display_name: m.owner_display_name!,
          bio: m.owner_bio, avatar_path: m.owner_avatar_path }),
      }
    : null;
  return {
    id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, body: m.body, clientId,
    video, videoRemoved: m.had_video && !m.video_id, createdAt: toIso(m.created_at)!,
  };
}

export type ReadRow = { conversation_id: string; user_id: string; last_read_at: string; last_delivered_at: string };
export type ReceiptResponse = { conversationId: string; userId: string; deliveredAt: string | null; readAt: string | null };

/** last_read_at holds the epoch as "never read" — the column is NOT NULL — and reads back as null. */
export function receipt(r: ReadRow): ReceiptResponse {
  return { conversationId: r.conversation_id, userId: r.user_id, deliveredAt: toIso(r.last_delivered_at),
    readAt: isEpoch(r.last_read_at) ? null : toIso(r.last_read_at) };
}

async function requireMessage(id: string): Promise<MessageRow> {
  const [row] = await sql<MessageRow[]>`select ${sql.unsafe(COLUMNS_TEXT)} ${sql.unsafe(FROM_TEXT)} where m.id = ${id}::uuid`;
  if (!row) throw new NotFoundError("Message", id);
  return row;
}

/**
 * Send. The order of the checks is the point: participation, then block, then the shared clip,
 * then the body, then the rate — a non-participant learns nothing else about the thread.
 */
export async function send(conversationId: string, senderId: string, rawBody: string | null, videoId: string | null): Promise<MessageRow> {
  const conversation = await requireParticipant(conversationId, senderId);
  await requireNotBlocked(senderId, other(conversation, senderId).id);
  let video: string | null = null;
  if (videoId) {
    const shareable = await findShareable(videoId);
    if (!shareable) throw new ValidationError(VIDEO_NOT_SHAREABLE);
    video = shareable.id;
  }
  const body = (rawBody ?? "").trim();
  if (!body && !video) throw new ValidationError(EMPTY_BODY);
  if (body.length > MAX_BODY) throw new ValidationError(TOO_LONG);
  if (!(await tryAcquire(`dm:send:${senderId}`, config.messaging.sendLimit, config.messaging.sendWindowMs))) {
    throw new TooManyRequestsError(RATE_LIMITED);
  }
  const id = await sql.begin(async (tx) => {
    const [inserted] = await tx<{ id: string; created_at: string }[]>`
      insert into messages (conversation_id, sender_id, body, video_id, had_video)
      values (${conversationId}::uuid, ${senderId}::uuid, ${body}, ${video}::uuid, ${video != null})
      returning id, created_at`;
    await tx`update conversations set last_message_at = ${inserted.created_at}::timestamptz where id = ${conversationId}::uuid`;
    // The sender has by definition read what they just sent.
    await tx`insert into conversation_reads (conversation_id, user_id, last_read_at, last_delivered_at)
             values (${conversationId}::uuid, ${senderId}::uuid, ${inserted.created_at}::timestamptz, ${inserted.created_at}::timestamptz)
             on conflict (conversation_id, user_id) do update set
               last_read_at = greatest(conversation_reads.last_read_at, excluded.last_read_at),
               last_delivered_at = greatest(conversation_reads.last_delivered_at, excluded.last_delivered_at)`;
    return inserted.id;
  });
  return requireMessage(id);
}

/** One page of a thread, newest first. */
export async function page(conversationId: string, viewerId: string, cursor: { createdAt: string; id: string } | null, limit: number | null): Promise<MessageRow[]> {
  await requireParticipant(conversationId, viewerId);
  const size = Math.min(100, Math.max(1, limit ?? config.messaging.pageSize));
  return cursor
    ? sql<MessageRow[]>`select ${sql.unsafe(COLUMNS_TEXT)} ${sql.unsafe(FROM_TEXT)} where m.conversation_id = ${conversationId}::uuid
        and (m.created_at < ${cursor.createdAt}::timestamptz or (m.created_at = ${cursor.createdAt}::timestamptz and m.id < ${cursor.id}::uuid))
        order by m.created_at desc, m.id desc limit ${size}`
    : sql<MessageRow[]>`select ${sql.unsafe(COLUMNS_TEXT)} ${sql.unsafe(FROM_TEXT)} where m.conversation_id = ${conversationId}::uuid
        order by m.created_at desc, m.id desc limit ${size}`;
}

/** What arrived after a moment — the reconciliation a polling client asks for. */
export async function since(conversationId: string, viewerId: string, after: string): Promise<MessageRow[]> {
  await requireParticipant(conversationId, viewerId);
  return sql<MessageRow[]>`select ${sql.unsafe(COLUMNS_TEXT)} ${sql.unsafe(FROM_TEXT)} where m.conversation_id = ${conversationId}::uuid
    and m.created_at > ${after}::timestamptz order by m.created_at asc, m.id asc limit 200`;
}

/** Never backwards; reading implies delivery. */
async function markRead(conversationId: string, userId: string): Promise<ReadRow> {
  const [row] = await sql<ReadRow[]>`
    insert into conversation_reads (conversation_id, user_id, last_read_at, last_delivered_at)
    values (${conversationId}::uuid, ${userId}::uuid, now(), now())
    on conflict (conversation_id, user_id) do update set
      last_read_at = greatest(conversation_reads.last_read_at, excluded.last_read_at),
      last_delivered_at = greatest(conversation_reads.last_delivered_at, excluded.last_delivered_at)
    returning *`;
  return row;
}

export async function markReadNow(conversationId: string, userId: string): Promise<ReadRow> {
  await requireParticipant(conversationId, userId);
  return markRead(conversationId, userId);
}

async function deliver(conversationId: string, userId: string): Promise<ReadRow> {
  const [row] = await sql<ReadRow[]>`
    insert into conversation_reads (conversation_id, user_id, last_read_at, last_delivered_at)
    values (${conversationId}::uuid, ${userId}::uuid, 'epoch'::timestamptz, now())
    on conflict (conversation_id, user_id) do update set
      last_delivered_at = greatest(conversation_reads.last_delivered_at, excluded.last_delivered_at)
    returning *`;
  return row;
}

export async function markDelivered(conversationId: string, userId: string): Promise<ReadRow> {
  await requireParticipant(conversationId, userId);
  return deliver(conversationId, userId);
}

/** Every thread with something newer than its last receipt — only those are touched and returned. */
export async function markAllDelivered(userId: string): Promise<ReadRow[]> {
  const moved: ReadRow[] = [];
  const threads = await listFor(userId);
  const reads = await readsFor(userId, threads.map((t) => t.id));
  for (const thread of threads) {
    if (!thread.last_message_at) continue;
    const row = reads.get(thread.id);
    if (row && Date.parse(toIso(row.last_delivered_at)!) >= Date.parse(toIso(thread.last_message_at)!)) continue;
    moved.push(await deliver(thread.id, userId));
  }
  return moved;
}

async function readsFor(userId: string, conversationIds: string[]): Promise<Map<string, ReadRow>> {
  const map = new Map<string, ReadRow>();
  if (conversationIds.length === 0) return map;
  const rows = await sql<ReadRow[]>`select * from conversation_reads
    where user_id = ${userId}::uuid and conversation_id = any(${conversationIds}::uuid[])`;
  for (const r of rows) map.set(r.conversation_id, r);
  return map;
}

export async function otherReceipt(conversation: ConversationRow, viewerId: string): Promise<ReceiptResponse | null> {
  const [row] = await sql<ReadRow[]>`select * from conversation_reads
    where conversation_id = ${conversation.id}::uuid and user_id = ${other(conversation, viewerId).id}::uuid`;
  return row ? receipt(row) : null;
}

export type ListSummary = { last: Map<string, MessageRow>; unread: Map<string, number>; otherReceipts: Map<string, ReadRow> };

/** Last message, unread count and the other side's receipt for a whole list — a handful of queries. */
export async function summarise(conversationIds: string[], viewerId: string): Promise<ListSummary> {
  const summary: ListSummary = { last: new Map(), unread: new Map(), otherReceipts: new Map() };
  if (conversationIds.length === 0) return summary;
  const last = await sql<MessageRow[]>`
    select distinct on (m.conversation_id) ${sql.unsafe(COLUMNS_TEXT)} ${sql.unsafe(FROM_TEXT)}
    where m.conversation_id = any(${conversationIds}::uuid[])
    order by m.conversation_id, m.created_at desc, m.id desc`;
  for (const m of last) summary.last.set(m.conversation_id, m);
  // Unread = messages from the other side newer than the viewer's read watermark (none → all).
  const unread = await sql<{ conversation_id: string; n: number }[]>`
    select m.conversation_id, count(*)::int as n from messages m
    left join conversation_reads r on r.conversation_id = m.conversation_id and r.user_id = ${viewerId}::uuid
    where m.conversation_id = any(${conversationIds}::uuid[]) and m.sender_id <> ${viewerId}::uuid
      and (r.last_read_at is null or m.created_at > r.last_read_at)
    group by m.conversation_id`;
  for (const u of unread) summary.unread.set(u.conversation_id, u.n);
  const receipts = await sql<ReadRow[]>`select * from conversation_reads
    where conversation_id = any(${conversationIds}::uuid[]) and user_id <> ${viewerId}::uuid`;
  for (const r of receipts) summary.otherReceipts.set(r.conversation_id, r);
  return summary;
}

export type ConversationResponse = {
  id: string; other: UserSummaryResponse; lastMessage: MessageResponseDto | null; unreadCount: number;
  otherReceipt: ReceiptResponse | null; blocked: boolean; lastMessageAt: string | null; createdAt: string;
};

export async function conversationResponse(thread: ConversationRow, viewerId: string, summary: ListSummary): Promise<ConversationResponse> {
  const them = other(thread, viewerId);
  const last = summary.last.get(thread.id);
  const theirs = summary.otherReceipts.get(thread.id);
  return {
    id: thread.id,
    other: userSummary(them),
    lastMessage: last ? messageDto(last, null) : null,
    unreadCount: summary.unread.get(thread.id) ?? 0,
    otherReceipt: theirs ? receipt(theirs) : null,
    blocked: await isBlockedBetween(viewerId, them.id),
    lastMessageAt: toIso(thread.last_message_at),
    createdAt: toIso(thread.created_at)!,
  };
}

export type ReportRow = { id: string; message_id: string; created_at: string };

/** Idempotent; only a participant may report, so the endpoint confirms no message id to outsiders. */
export async function report(messageId: string, reporterId: string, reason: string | null): Promise<ReportRow> {
  const message = await requireMessage(messageId);
  const conversation = await requireParticipant(message.conversation_id, reporterId).catch((e) => {
    if (e instanceof ForbiddenError) throw new ForbiddenError(NOT_A_PARTICIPANT);
    throw e;
  });
  if (!includes(conversation, reporterId)) throw new ForbiddenError(NOT_A_PARTICIPANT);
  const [existing] = await sql<ReportRow[]>`select id, message_id, created_at from message_reports
    where message_id = ${messageId}::uuid and reporter_id = ${reporterId}::uuid`;
  if (existing) return existing;
  const [row] = await sql<ReportRow[]>`
    insert into message_reports (message_id, reporter_id, body_at_report, reason)
    values (${messageId}::uuid, ${reporterId}::uuid, ${message.body}, ${reason})
    returning id, message_id, created_at`;
  return row;
}
