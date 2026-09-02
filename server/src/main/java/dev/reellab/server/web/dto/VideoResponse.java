package dev.reellab.server.web.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Note what changes shape between storage and response: the entity holds
 * {@code manifestPath} (relative), the client receives {@code manifestUrl}
 * (absolute). That composition happens in the web layer.
 */
public record VideoResponse(
        UUID id,
        UserResponse owner,
        String title,
        String description,
        int durationSeconds,
        String manifestUrl,
        String posterUrl,
        boolean published,
        long likeCount,
        /** Whether the viewer who asked has liked it. False when nobody was named. */
        boolean likedByViewer,
        Instant createdAt,
        Instant updatedAt) {
}
