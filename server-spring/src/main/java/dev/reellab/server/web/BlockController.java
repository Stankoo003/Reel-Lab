package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.UserBlockEntity;
import dev.reellab.server.service.BlockService;
import dev.reellab.server.service.MessageService;
import dev.reellab.server.web.dto.ReportMessageRequest;
import dev.reellab.server.web.dto.UserSummaryResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Blocking someone, and reporting a message. */
@RestController
public class BlockController {

    private final BlockService blocks;
    private final MessageService messages;
    private final MediaUrlAssembler media;

    public BlockController(BlockService blocks, MessageService messages, MediaUrlAssembler media) {
        this.blocks = blocks;
        this.messages = messages;
        this.media = media;
    }

    /** PUT and DELETE, idempotent both ways — the same shape as a like or a follow. */
    @PutMapping("/api/users/{id}/block")
    public ResponseEntity<Void> block(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        blocks.block(CurrentUser.id(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/users/{id}/block")
    public ResponseEntity<Void> unblock(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        blocks.unblock(CurrentUser.id(jwt), id);
        return ResponseEntity.noContent().build();
    }

    /** Who you have blocked. Never who has blocked you — that is not yours to know. */
    @GetMapping("/api/blocks")
    public List<UserSummaryResponse> listBlocked(@AuthenticationPrincipal Jwt jwt) {
        return blocks.blockedBy(CurrentUser.id(jwt)).stream()
                .map(UserBlockEntity::getBlocked)
                .map(user -> new UserSummaryResponse(user.getId(), user.getUsername(),
                        user.getDisplayName(), user.getBio(), media.toUrl(user.getAvatarPath())))
                .toList();
    }

    /**
     * Report a message.
     *
     * <p>Records the message, the reporter, and a copy of the body as it was reported — see
     * MessageReportEntity for why the body is copied rather than only referenced.
     */
    @PostMapping("/api/messages/{id}/report")
    public Map<String, Object> report(@PathVariable UUID id,
                                      @Valid @RequestBody(required = false) ReportMessageRequest request,
                                      @AuthenticationPrincipal Jwt jwt) {
        var report = messages.report(id, CurrentUser.id(jwt),
                request == null ? null : request.reason());
        return Map.of(
                "id", report.getId(),
                "messageId", id,
                "reportedAt", report.getCreatedAt());
    }
}
