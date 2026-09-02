package dev.reellab.server.web.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A comment and, for a top-level one, its replies. {@code replies} is always empty on a
 * reply — the API is two levels deep and no more.
 *
 * @param body plain text, exactly as stored. Nothing here interprets markup.
 * @param updatedAt differs from createdAt once the author has edited; editing is allowed and
 *     does not count as a new comment
 */
public record CommentResponse(
        UUID id,
        UserResponse author,
        String body,
        Instant createdAt,
        Instant updatedAt,
        List<CommentResponse> replies) {
}
