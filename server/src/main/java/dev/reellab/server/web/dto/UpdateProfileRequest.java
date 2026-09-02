package dev.reellab.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * The editable parts of a profile. Username is not among them — it identifies the account —
 * and neither is email, which has no route in or out of the API.
 *
 * @param bio null leaves the bio as it is; an empty string clears it
 * @param avatarPath the RELATIVE path returned by POST /api/media with kind=avatar, never a
 *     URL and never a client-chosen filename
 */
public record UpdateProfileRequest(
        @NotBlank(message = "Display name cannot be empty")
        @Size(max = 100, message = "Display name must be 100 characters or fewer")
        String displayName,

        @Size(max = 500, message = "Bio must be 500 characters or fewer")
        String bio,

        @Size(max = 500)
        @Pattern(
                regexp = "^(?![a-zA-Z][a-zA-Z0-9+.-]*://)(?!/).*$",
                message = "Avatar must be a relative path, not a URL")
        String avatarPath) {
}
