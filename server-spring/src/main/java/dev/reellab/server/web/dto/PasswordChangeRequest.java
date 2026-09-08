package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotBlank;

/** Change the password of the signed-in account. The current one is the proof it is you. */
public record PasswordChangeRequest(
        @NotBlank(message = "Enter your current password")
        String currentPassword,
        @NotBlank(message = "Choose a new password")
        String newPassword) {
}
