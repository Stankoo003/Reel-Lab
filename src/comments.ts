// Comments, on top of the generated typed client.
//
// The one rule worth knowing before reading anything else: a user gets ONE top-level
// comment and ONE reply per parent, per video. The server enforces it with a unique
// constraint and answers a second attempt with 409. The UI's job is to say so up front
// rather than let someone write a comment and lose it on submit.
import { addComment, editComment, fetchCommentPage } from "../api/client";
import type { CommentResponse } from "../api/client";

export type Comment = {
  id: string;
  authorId: string;
  authorName: string;
  /** Plain text. Rendered inside <Text>, which never interprets markup. */
  body: string;
  createdAt: string;
  /** Later than createdAt once edited — an edit keeps the one comment, it never adds one. */
  updatedAt: string;
  edited: boolean;
  replies: Comment[];
};

export type CommentPage = {
  comments: Comment[];
  nextCursor: string | null;
  hasNext: boolean;
};

function toComment(c: CommentResponse): Comment {
  const createdAt = c.createdAt ?? "";
  const updatedAt = c.updatedAt ?? createdAt;
  return {
    id: c.id ?? "",
    authorId: c.author?.id ?? "",
    authorName: c.author?.displayName ?? c.author?.username ?? "unknown",
    body: c.body ?? "",
    createdAt,
    updatedAt,
    // Parsed, not compared as strings: the same instant serialised with and without
    // fractional seconds would mark a never-edited comment as edited.
    edited: Date.parse(updatedAt) !== Date.parse(createdAt),
    replies: (c.replies ?? []).map(toComment),
  };
}

export async function fetchComments(videoId: string, cursor?: string | null): Promise<CommentPage> {
  const page = await fetchCommentPage(videoId, cursor);
  return {
    comments: page.items.map(toComment),
    nextCursor: page.nextCursor,
    hasNext: page.hasNext,
  };
}

export async function postComment(
  videoId: string,
  body: string,
  parentId?: string | null
): Promise<Comment> {
  return toComment(await addComment(videoId, body, parentId));
}

export async function updateComment(id: string, body: string): Promise<Comment> {
  return toComment(await editComment(id, body));
}

/** Your own comment, if you have one on this page. Null means the slot is free. */
export function findOwnRoot(comments: Comment[], userId: string): Comment | null {
  return comments.find((c) => c.authorId === userId) ?? null;
}
