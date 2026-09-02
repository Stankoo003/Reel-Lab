package dev.reellab.server.web.dto;

import dev.reellab.server.persistence.entity.UserEntity;
import java.time.Instant;
import java.util.UUID;

public record UserResponse(UUID id, String username, String displayName, Instant createdAt) {

    public static UserResponse from(UserEntity user) {
        return new UserResponse(user.getId(), user.getUsername(), user.getDisplayName(),
                user.getCreatedAt());
    }
}
