package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.CommentEntity;
import dev.reellab.server.service.CommentService;
import dev.reellab.server.web.dto.CommentPageResponse;
import dev.reellab.server.web.dto.CommentResponse;
import dev.reellab.server.web.dto.CreateCommentRequest;
import dev.reellab.server.web.dto.UpdateCommentRequest;
import dev.reellab.server.web.dto.UserResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Paths are on the methods rather than the class because these routes straddle two
 * collections: a thread hangs off a video, an individual comment does not.
 */
@RestController
public class CommentController {

    private final CommentService comments;

    public CommentController(CommentService comments) {
        this.comments = comments;
    }

    @GetMapping("/api/videos/{videoId}/comments")
    public CommentPageResponse thread(
            @PathVariable UUID videoId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int limit) {

        PageCursor position = CursorPages.decodeOrNull(cursor);
        CommentService.Thread thread = comments.threadFor(
                videoId, CursorPages.createdAtOf(position), CursorPages.idOf(position), limit);

        List<CommentResponse> items = thread.roots().stream()
                .map(root -> toResponse(root, thread.repliesTo(root.getId())))
                .toList();

        String nextCursor = CursorPages.nextCursor(thread.roots(), thread.hasNext(),
                c -> new PageCursor(c.getCreatedAt(), c.getId()));
        return new CommentPageResponse(items, nextCursor, thread.hasNext());
    }

    @PostMapping("/api/videos/{videoId}/comments")
    public ResponseEntity<CommentResponse> add(@PathVariable UUID videoId,
                                               @Valid @RequestBody CreateCommentRequest request,
                                               @AuthenticationPrincipal Jwt jwt) {
        CommentEntity saved = comments.add(videoId, CurrentUser.id(jwt), request.parentId(),
                request.body());
        return ResponseEntity.ok(toResponse(saved, List.of()));
    }

    /** Editing keeps the one comment you are allowed; it never creates a second. */
    @PatchMapping("/api/comments/{id}")
    public CommentResponse edit(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt,
                                @Valid @RequestBody UpdateCommentRequest request) {
        CommentService.Edited edited = comments.edit(id, request.body(), CurrentUser.id(jwt));
        // With its replies, not List.of(): a client patching this response into a rendered
        // thread would otherwise make every reply to an edited root disappear.
        return toResponse(edited.comment(), edited.replies());
    }

    @DeleteMapping("/api/comments/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        comments.delete(id, CurrentUser.id(jwt));
        return ResponseEntity.noContent().build();
    }

    private CommentResponse toResponse(CommentEntity comment, List<CommentEntity> replies) {
        return new CommentResponse(
                comment.getId(),
                UserResponse.from(comment.getAuthor()),
                // Returned byte for byte as it was stored. No sanitising, no escaping, no
                // rendering: the body is text, and it is the client's job to display it as
                // text — which a React Native <Text> does by construction.
                comment.getBody(),
                comment.getCreatedAt(),
                comment.getUpdatedAt(),
                replies.stream().map(r -> toResponse(r, List.of())).toList());
    }
}
