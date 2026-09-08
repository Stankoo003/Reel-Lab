package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/** Start (or find) the conversation with one other person. */
public record OpenConversationRequest(@NotNull UUID userId) {
}
