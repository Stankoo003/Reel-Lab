package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Deliberately unvalidated beyond "present". A login must answer the same way for every
 * wrong credential; rejecting a malformed email with a different status would tell a caller
 * which addresses are worth trying.
 */
public record LoginRequest(@NotBlank String email, @NotBlank String password) {
}
