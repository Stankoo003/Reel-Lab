package dev.reellab.server.web.dto;

import java.util.UUID;

/**
 * The state of a video's likes after liking or unliking.
 *
 * <p>The authoritative count comes back with every toggle so an optimistic client has
 * something to reconcile against — its guess is replaced by this, which is what stops a
 * count drifting after rapid toggling.
 */
public record VideoLikeResponse(UUID videoId, long likeCount, boolean likedByViewer) {
}
