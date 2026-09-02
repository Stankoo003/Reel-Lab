package dev.reellab.server.service;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.persistence.repository.VideoRepository;
import dev.reellab.server.service.exception.NotFoundException;
import dev.reellab.server.service.exception.ValidationException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class VideoService {

    private final VideoRepository videos;
    private final UserService userService;

    public VideoService(VideoRepository videos, UserService userService) {
        this.videos = videos;
        this.userService = userService;
    }

    /**
     * The offset listing. {@code ownerId} narrows it to one user's videos, drafts included —
     * that is what backs "My videos", and it belongs in the query rather than in a caller
     * filtering a global page.
     */
    @Transactional(readOnly = true)
    public Page<VideoEntity> list(boolean publishedOnly, UUID ownerId, Pageable pageable) {
        if (ownerId != null) {
            return videos.findByOwnerId(ownerId, pageable);
        }
        return publishedOnly ? videos.findByPublishedTrue(pageable) : videos.findAllBy(pageable);
    }

    /**
     * One page of the public feed: published videos, newest first, tie-broken by id.
     *
     * <p>Keyset, not offset. An offset page shifts under the reader every time a video is
     * published, which an infinite feed shows as duplicated or skipped rows; a cursor
     * anchors to a row instead of a position.
     *
     * <p>Pass both cursor components or neither — a cursor always carries both, so a half
     * cursor cannot arrive from a well-formed request.
     */
    @Transactional(readOnly = true)
    public FeedSlice feed(Instant cursorCreatedAt, UUID cursorId, int limit) {
        // One row more than asked for: if it comes back there is a next page. That is
        // cheaper than a count(*) over the whole table, and the extra row never escapes.
        Limit fetch = Limit.of(limit + 1);
        List<VideoEntity> rows = cursorCreatedAt == null
                ? videos.findByPublishedTrueOrderByCreatedAtDescIdDesc(fetch)
                : videos.findFeedAfter(cursorCreatedAt, cursorId, fetch);

        boolean hasNext = rows.size() > limit;
        return new FeedSlice(hasNext ? List.copyOf(rows.subList(0, limit)) : List.copyOf(rows),
                hasNext);
    }

    @Transactional(readOnly = true)
    public VideoEntity require(UUID id) {
        return videos.findWithOwnerById(id).orElseThrow(() -> new NotFoundException("Video", id));
    }

    @Transactional
    public VideoEntity create(UUID ownerId, String title, String description, int durationSeconds,
                              String manifestPath, String posterPath) {
        UserEntity owner = userService.require(ownerId);
        MediaPaths.requireRelative("manifestPath", manifestPath);
        MediaPaths.requireRelative("posterPath", posterPath);
        return videos.save(
                new VideoEntity(owner, title, description, durationSeconds, manifestPath, posterPath));
    }

    @Transactional
    public VideoEntity setPublished(UUID id, boolean published, UUID actor) {
        VideoEntity video = require(id);
        UserService.requireSelf(actor, video.getOwner().getId(), "video");
        video.setPublished(published);
        return video;
    }

    @Transactional
    public void delete(UUID id, UUID actor) {
        VideoEntity video = require(id);
        UserService.requireSelf(actor, video.getOwner().getId(), "video");
        videos.delete(video);
    }

    /**
     * One page of the feed. Plain data — no JPA paging, no HTTP. The cursor that points at
     * the next page is derived from the last video by the web layer, which owns its format.
     */
    public record FeedSlice(List<VideoEntity> videos, boolean hasNext) {
    }

}
