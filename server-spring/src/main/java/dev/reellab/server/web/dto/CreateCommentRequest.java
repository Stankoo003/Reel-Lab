package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * A new comment. Text only — there is no media field and no formatting field, and the body
 * is stored and returned exactly as sent. Nothing on either side interprets markup in it.
 */
public record CreateCommentRequest(
        /** Null for a top-level comment, the root's id for a reply. Replies stop at one level. */
        UUID parentId,
        @NotBlank @Size(max = 2000) String body) {
}
