package dev.reellab.server.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * No displayName: the client sends the username and the server starts the display name off
 * as the same text. Asking twice at signup would be this form taking a decision the profile
 * screen already owns and can change afterwards.
 */
public record SignupRequest(
        @NotBlank @Size(max = 50) String username,
        @NotBlank @Email @Size(max = 255) String email,
        // Only a floor here. The real rule lives in AuthService, so it holds for every path
        // into signup rather than only for a well-formed request body.
        @NotBlank @Size(min = 8, max = 200) String password) {
}
