package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record CreateVideoRequest(
        @NotBlank @Size(max = 200) String title,
        String description,
        @Positive int durationSeconds,
        @NotBlank @Size(max = 500) String manifestPath,
        @Size(max = 500) String posterPath) {
}
