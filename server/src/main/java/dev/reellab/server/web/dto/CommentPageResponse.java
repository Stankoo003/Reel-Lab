package dev.reellab.server.web.dto;

import java.util.List;

/**
 * One page of a comment thread, oldest first.
 *
 * <p>Only the top-level comments are paginated. Each carries all of its replies, because a
 * reply is capped at one per author per parent — the fan-out is bounded, and paginating it
 * would turn reading a two-level thread into N+1 requests.
 *
 * @param nextCursor opaque position of the last root on this page, or {@code null} when
 *     {@code hasNext} is false
 */
public record CommentPageResponse(List<CommentResponse> items, String nextCursor, boolean hasNext) {
}
