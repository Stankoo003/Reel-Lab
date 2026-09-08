package dev.reellab.server.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Ask for a reset link.
 *
 * <p>The address is validated for SHAPE only. Whether it has an account is deliberately not
 * something this endpoint's answer depends on — see PasswordResetService.
 */
public record PasswordResetRequest(
        @NotBlank(message = "Enter your email address")
        @Email(message = "That does not look like an email address")
        String email) {
}
