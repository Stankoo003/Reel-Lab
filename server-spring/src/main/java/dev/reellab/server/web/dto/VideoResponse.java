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
        /**
         * Whether the viewer follows this video's owner.
         *
         * <p>On the video rather than fetched per author by the client, because the feed
         * shows it under every clip and the alternative is one profile request per row.
         * False signed out, and false on your own clip.
         */
        boolean ownerFollowedByViewer,
        Instant createdAt,
        Instant updatedAt) {
}
