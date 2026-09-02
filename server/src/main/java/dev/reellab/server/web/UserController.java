package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.service.UserService;
import dev.reellab.server.web.dto.ProfileResponse;
import dev.reellab.server.web.dto.UpdateProfileRequest;
import dev.reellab.server.web.dto.UserResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService users;
    private final MediaUrlAssembler media;

    public UserController(UserService users, MediaUrlAssembler media) {
        this.users = users;
        this.media = media;
    }

    @GetMapping
    public List<UserResponse> list() {
        return users.findAll().stream().map(UserResponse::from).toList();
    }

    @GetMapping("/{id}")
    public UserResponse get(@PathVariable UUID id) {
        return UserResponse.from(users.require(id));
    }

    /**
     * A user's profile, with their activity counts.
     *
     * <p>Identical for everyone who asks. There is no viewer parameter because there is
     * nothing this endpoint would say differently to one — see {@link ProfileResponse} for
     * why nothing private is returned even on your own profile.
     */
    @GetMapping("/{id}/profile")
    public ProfileResponse profile(@PathVariable UUID id) {
        return toProfile(users.require(id));
    }

    /** Edit a profile. Yours only — the id in the path must be the id in the token. */
    @PatchMapping("/{id}")
    public ProfileResponse updateProfile(@PathVariable UUID id,
                                         @Valid @RequestBody UpdateProfileRequest request,
                                         @AuthenticationPrincipal Jwt jwt) {
        UserService.requireSelf(CurrentUser.id(jwt), id, "profile");
        return toProfile(users.updateProfile(
                id, request.displayName(), request.bio(), request.avatarPath()));
    }

    private ProfileResponse toProfile(UserEntity user) {
        UserService.Activity activity = users.activityOf(user.getId());
        return new ProfileResponse(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getBio(),
                // Relative path in, absolute URL out — the same composition the feed does.
                media.toUrl(user.getAvatarPath()),
                user.getCreatedAt(),
                new ProfileResponse.ProfileActivity(
                        activity.publishedVideos(), activity.comments(), activity.likesReceived()));
    }
}
