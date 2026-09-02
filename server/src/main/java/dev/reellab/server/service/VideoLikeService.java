package dev.reellab.server.service;

import dev.reellab.server.persistence.repository.VideoLikeRepository;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class VideoLikeService {

    private final VideoLikeRepository likes;
    private final VideoService videoService;
    private final UserService userService;

    public VideoLikeService(VideoLikeRepository likes, VideoService videoService,
                            UserService userService) {
        this.likes = likes;
        this.videoService = videoService;
        this.userService = userService;
    }

    /**
     * Like a video. Idempotent: liking something already liked succeeds and changes nothing.
     *
     * <p>This is where likes deliberately differ from comments. A second comment is a second
     * piece of content, so it is a 409 the author must resolve. A like is one bit of state,
     * and the client toggling it is allowed to retry, replay or race itself — an optimistic
     * UI does exactly that. Answering "you already liked this" with an error would make the
     * count drift the moment a retry landed, so the honest answer to "make this liked" is
     * "it is liked".
     *
     * <p>The constraint is still the guarantee, and it is applied where a race can actually be
     * survived: {@code insertIgnoringDuplicate} uses ON CONFLICT DO NOTHING, so a concurrent
     * like by the same user is absorbed by the database without an exception ever being raised.
     * Catching the violation in Java cannot work — see that method for why.
     */
    @Transactional
    public LikeState like(UUID videoId, UUID userId) {
        // Both looked up so an unknown video or user is a 404 rather than a foreign-key error.
        videoService.require(videoId);
        userService.require(userId);

        likes.insertIgnoringDuplicate(videoId, userId);
        return new LikeState(likes.countByVideoId(videoId), true);
    }

    /**
     * Remove a like. Idempotent in the same way: unliking something not liked is a no-op, so
     * a repeated or replayed request cannot push the count below the truth.
     */
    @Transactional
    public LikeState unlike(UUID videoId, UUID userId) {
        videoService.require(videoId);
        likes.deleteByVideoIdAndUserId(videoId, userId);
        return new LikeState(likes.countByVideoId(videoId), false);
    }

    /**
     * Like counts for a page of videos, and which of them the viewer has liked.
     *
     * <p>Two queries for the whole page rather than two per row — the same shape as loading a
     * comment thread's replies. {@code viewerId} may be null: there is no authentication yet,
     * so an anonymous read simply has no likes of its own.
     */
    @Transactional(readOnly = true)
    public LikeSummary summarise(Collection<UUID> videoIds, UUID viewerId) {
        if (videoIds.isEmpty()) {
            return new LikeSummary(Map.of(), Set.of());
        }
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : likes.countsByVideoIds(videoIds)) {
            counts.put((UUID) row[0], (Long) row[1]);
        }
        Set<UUID> liked = viewerId == null
                ? Set.of()
                : Set.copyOf(likes.likedVideoIds(viewerId, videoIds));
        return new LikeSummary(counts, liked);
    }

    /** The state of one video's likes after a change. */
    public record LikeState(long likeCount, boolean likedByViewer) {
    }

    /** Like data for a page of videos. Absent from {@code counts} means zero. */
    public record LikeSummary(Map<UUID, Long> counts, Set<UUID> likedByViewer) {

        public long countFor(UUID videoId) {
            return counts.getOrDefault(videoId, 0L);
        }

        public boolean isLikedBy(UUID videoId) {
            return likedByViewer.contains(videoId);
        }
    }
}
