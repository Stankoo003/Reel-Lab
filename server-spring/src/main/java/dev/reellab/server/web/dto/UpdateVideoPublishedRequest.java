package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateVideoPublishedRequest(@NotNull Boolean published) {
}
