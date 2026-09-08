package dev.reellab.server.web.dto;

import java.util.UUID;

/**
 * The answer to following or unfollowing someone.
 *
 * <p>Shaped like {@link VideoLikeResponse}: the state that now holds, so an optimistic button
 * has something authoritative to settle on instead of keeping the guess it made when it was
 * pressed.
 *
 * @param userId the user who was followed or unfollowed — never the viewer
 */
public record FollowResponse(
        UUID userId, long followers, long following, boolean followedByViewer) {
}
