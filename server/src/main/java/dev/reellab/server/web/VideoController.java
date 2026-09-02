package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.service.VideoLikeService;
import dev.reellab.server.service.VideoService;
import dev.reellab.server.web.dto.CreateVideoRequest;
import dev.reellab.server.web.dto.UpdateVideoPublishedRequest;
import dev.reellab.server.web.dto.VideoFeedResponse;
import dev.reellab.server.web.dto.VideoLikeResponse;
import dev.reellab.server.web.dto.VideoResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/videos")
public class VideoController {

    private final VideoService videos;
    private final VideoLikeService likes;
    private final VideoMapper mapper;

    public VideoController(VideoService videos, VideoLikeService likes, VideoMapper mapper) {
        this.videos = videos;
        this.likes = likes;
        this.mapper = mapper;
    }

    @GetMapping
    public Page<VideoResponse> list(
            @RequestParam(defaultValue = "true") boolean publishedOnly,
            // @ParameterObject expands Pageable into flat page/size/sort query params in
            // the OpenAPI contract. Without it the contract describes a single object
            // parameter, and a generated client serialises it as JSON in the query string —
            // which Tomcat rejects with 400 before the controller is ever reached.
            @ParameterObject
            @PageableDefault(size = 20, sort = "createdAt", direction = Sort.Direction.DESC)
            Pageable pageable,
            @RequestParam(required = false) UUID ownerId,
            @AuthenticationPrincipal Jwt jwt) {
        Page<VideoEntity> page = videos.list(publishedOnly, ownerId, pageable);
        VideoLikeService.LikeSummary summary =
                likes.summarise(page.map(VideoEntity::getId).toList(), CurrentUser.idOrNull(jwt));
        return page.map(v -> mapper.toResponse(
                v, summary.countFor(v.getId()), summary.isLikedBy(v.getId())));
    }

    /**
     * The public feed. Cursor-paginated rather than offset-paginated: see
     * {@link VideoService#feed}.
     *
     * <p>Scalar query params, so unlike {@code list} above this needs no
     * {@code @ParameterObject} — the generated client already sends them flat.
     */
    @GetMapping("/feed")
    public VideoFeedResponse feed(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int limit,
            // Public, so the token is optional rather than required: signed out, the counts
            // are still right and only "did I like this" is unanswerable and comes back
            // false. Signed in, it is answered from the token — the viewer can no longer
            // name themselves as someone else.
            @AuthenticationPrincipal Jwt jwt) {

        PageCursor position = CursorPages.decodeOrNull(cursor);
        VideoService.FeedSlice slice = videos.feed(
                CursorPages.createdAtOf(position), CursorPages.idOf(position), limit);

        // One extra pair of queries for the whole page, not per row.
        VideoLikeService.LikeSummary summary = likes.summarise(
                slice.videos().stream().map(VideoEntity::getId).toList(), CurrentUser.idOrNull(jwt));
        List<VideoResponse> items = slice.videos().stream()
                .map(v -> mapper.toResponse(
                        v, summary.countFor(v.getId()), summary.isLikedBy(v.getId())))
                .toList();
        // The cursor points at the last row actually returned, so the next page resumes
        // exactly where this one stopped.
        String nextCursor = CursorPages.nextCursor(slice.videos(), slice.hasNext(),
                v -> new PageCursor(v.getCreatedAt(), v.getId()));
        return new VideoFeedResponse(items, nextCursor, slice.hasNext());
    }

    @GetMapping("/{id}")
    public VideoResponse get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        VideoEntity video = videos.require(id);
        VideoLikeService.LikeSummary summary = likes.summarise(List.of(id), CurrentUser.idOrNull(jwt));
        return mapper.toResponse(video, summary.countFor(id), summary.isLikedBy(id));
    }

    /**
     * Like a video. Idempotent, so an optimistic client may retry or replay it without the
     * count drifting — see {@link VideoLikeService#like}.
     */
    @PutMapping("/{id}/like")
    public VideoLikeResponse like(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        VideoLikeService.LikeState state = likes.like(id, CurrentUser.id(jwt));
        return new VideoLikeResponse(id, state.likeCount(), state.likedByViewer());
    }

    /** Remove a like. Also idempotent: unliking what is not liked changes nothing. */
    @DeleteMapping("/{id}/like")
    public VideoLikeResponse unlike(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        VideoLikeService.LikeState state = likes.unlike(id, CurrentUser.id(jwt));
        return new VideoLikeResponse(id, state.likeCount(), state.likedByViewer());
    }

    @PostMapping
    public ResponseEntity<VideoResponse> create(@Valid @RequestBody CreateVideoRequest request,
                                                @AuthenticationPrincipal Jwt jwt) {
        VideoResponse created = mapper.toResponse(videos.create(
                CurrentUser.id(jwt), request.title(), request.description(),
                request.durationSeconds(), request.manifestPath(), request.posterPath()));
        return ResponseEntity.created(URI.create("/api/videos/" + created.id())).body(created);
    }

    @PatchMapping("/{id}")
    public VideoResponse setPublished(@PathVariable UUID id,
                                      @Valid @RequestBody UpdateVideoPublishedRequest request,
                                      @AuthenticationPrincipal Jwt jwt) {
        VideoEntity video = videos.setPublished(id, request.published(), CurrentUser.id(jwt));
        VideoLikeService.LikeSummary summary = likes.summarise(List.of(id), null);
        return mapper.toResponse(video, summary.countFor(id), false);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        videos.delete(id, CurrentUser.id(jwt));
        return ResponseEntity.noContent().build();
    }
}
