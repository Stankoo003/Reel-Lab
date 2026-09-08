package dev.reellab.server.web.dto;

import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.web.MediaUrlAssembler;
import java.util.UUID;

/**
 * A clip as it appears inside a message: enough to draw the card and to play it.
 *
 * <p>Smaller than {@link VideoResponse} on purpose. Likes, follow state and the rest belong
 * to the feed, and a thread with fifty shared clips should not pay for fifty like counts.
 */
public record SharedVideoDto(
        UUID id,
        String title,
        int durationSeconds,
        String manifestUrl,
        String posterUrl,
        UserSummaryResponse owner) {

    public static SharedVideoDto from(VideoEntity video, MediaUrlAssembler media) {
        var owner = video.getOwner();
        return new SharedVideoDto(
                video.getId(),
                video.getTitle(),
                video.getDurationSeconds(),
                media.toUrl(video.getManifestPath()),
                media.toUrl(video.getPosterPath()),
                new UserSummaryResponse(owner.getId(), owner.getUsername(), owner.getDisplayName(),
                        owner.getBio(), media.toUrl(owner.getAvatarPath())));
    }
}
