package dev.reellab.server.web.dto;

import dev.reellab.server.persistence.entity.UserEntity;
import java.time.Instant;
import java.util.UUID;

/**
 * A user as every other response refers to them — a video's owner, a comment's author, the
 * account a token belongs to.
 *
 * <p>Still no email and no credential: that is the invariant ProfileIntegrationTest asserts
 * across the whole API, and it holds for your own account too.
 *
 * @param avatarUrl absolute, or null when they have not set one. The database stores a
 *     relative path and never a URL, so the composition happens in the web layer — which is
 *     why it is passed in rather than read off the entity here.
 */
public record UserResponse(
        UUID id, String username, String displayName, String avatarUrl, Instant createdAt) {

    /**
     * @param avatarUrl from {@code MediaUrlAssembler.toUrl(user.getAvatarPath())}
     */
    public static UserResponse from(UserEntity user, String avatarUrl) {
        return new UserResponse(user.getId(), user.getUsername(), user.getDisplayName(),
                avatarUrl, user.getCreatedAt());
    }
}
