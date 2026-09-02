package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * New text for an existing comment. Editing is an update, not a new comment, so it does not
 * count against the one-per-author rule — which is what makes that rule livable.
 */
public record UpdateCommentRequest(@NotBlank @Size(max = 2000) String body) {
}
