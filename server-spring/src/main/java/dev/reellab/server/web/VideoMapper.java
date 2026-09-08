package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.web.dto.UserResponse;
import dev.reellab.server.web.dto.VideoResponse;
import org.springframework.stereotype.Component;

/** Entity to response DTO, including relative path to absolute URL. */
@Component
public class VideoMapper {

    private final MediaUrlAssembler media;

    public VideoMapper(MediaUrlAssembler media) {
        this.media = media;
    }

    /**
     * Like data is passed in rather than looked up here: a page of videos needs its counts
     * fetched in one query, and a mapper that did its own lookup would turn that back into
     * one query per row.
     */
    public VideoResponse toResponse(VideoEntity video, long likeCount, boolean likedByViewer,
                                    boolean ownerFollowedByViewer) {
        return new VideoResponse(
                video.getId(),
                UserResponse.from(video.getOwner(), media.toUrl(video.getOwner().getAvatarPath())),
                video.getTitle(),
                video.getDescription(),
                video.getDurationSeconds(),
                media.toUrl(video.getManifestPath()),
                media.toUrl(video.getPosterPath()),
                video.isPublished(),
                likeCount,
                likedByViewer,
                ownerFollowedByViewer,
                video.getCreatedAt(),
                video.getUpdatedAt());
    }

    /**
     * For a video whose viewer-relative state is not in question: one just created, whose
     * owner is the caller, so there are no likes yet and following yourself is not a thing.
     */
    public VideoResponse toResponse(VideoEntity video) {
        return toResponse(video, 0L, false, false);
    }
}
