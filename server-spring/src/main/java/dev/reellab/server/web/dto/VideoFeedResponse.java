package dev.reellab.server.web.dto;

import java.util.List;

/**
 * One page of the feed.
 *
 * <p>No page number and no total: neither is meaningful for a feed that grows while it is
 * read. A client asks for the next page by sending {@code nextCursor} back verbatim.
 *
 * @param nextCursor opaque position of the last item, or {@code null} when {@code hasNext}
 *     is false — so "am I done" is answerable without inspecting the cursor
 */
public record VideoFeedResponse(List<VideoResponse> items, String nextCursor, boolean hasNext) {
}
