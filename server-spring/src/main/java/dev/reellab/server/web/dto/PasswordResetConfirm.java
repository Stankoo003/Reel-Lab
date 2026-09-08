package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotBlank;

/** Spend a reset token and set a new password. */
public record PasswordResetConfirm(
        @NotBlank(message = "The reset link is missing its token")
        String token,
        @NotBlank(message = "Choose a new password")
        String newPassword) {
}
