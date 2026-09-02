package dev.reellab.server.web.dto;

import dev.reellab.server.persistence.entity.UserEntity;

/**
 * The token, plus who it belongs to — so a client that has just signed in does not have to
 * follow up with a second request to learn its own name.
 *
 * {@link UserResponse} carries no email and no credential, which is the invariant
 * ProfileIntegrationTest asserts across the whole API. The token already proves identity;
 * echoing the address back would widen what a leaked response exposes for nothing.
 */
public record AuthResponse(String token, UserResponse user) {

    public static AuthResponse of(String token, UserEntity user) {
        return new AuthResponse(token, UserResponse.from(user));
    }
}
