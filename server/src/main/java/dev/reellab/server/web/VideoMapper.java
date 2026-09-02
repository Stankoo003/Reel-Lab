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
    public VideoResponse toResponse(VideoEntity video, long likeCount, boolean likedByViewer) {
        return new VideoResponse(
                video.getId(),
                UserResponse.from(video.getOwner()),
                video.getTitle(),
                video.getDescription(),
                video.getDurationSeconds(),
                media.toUrl(video.getManifestPath()),
                media.toUrl(video.getPosterPath()),
                video.isPublished(),
                likeCount,
                likedByViewer,
                video.getCreatedAt(),
                video.getUpdatedAt());
    }

    /** For a video that cannot have likes yet — one just created. */
    public VideoResponse toResponse(VideoEntity video) {
        return toResponse(video, 0L, false);
    }
}
