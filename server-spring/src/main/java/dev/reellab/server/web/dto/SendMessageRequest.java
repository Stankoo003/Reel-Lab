package dev.reellab.server.web.dto;

import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * @param body the text. May be empty when a video is attached — a shared clip needs no
 *     words — and must not be otherwise; the service enforces that, so the socket path
 *     and this one agree.
 * @param clientId the sender's own id for this message, generated before it was sent. It is
 *     what makes a retry safe to display: the copy that comes back carries it, so the client
 *     replaces its pending bubble instead of drawing a second one.
 * @param videoId a published clip to share into the thread, or null
 */
public record SendMessageRequest(
        @Size(max = 4000, message = "A message can be at most 4000 characters")
        String body,
        String clientId,
        UUID videoId) {
}
