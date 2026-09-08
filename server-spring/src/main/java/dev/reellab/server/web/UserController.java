package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.service.FollowService;
import dev.reellab.server.service.UserService;
import dev.reellab.server.web.dto.FollowResponse;
import dev.reellab.server.web.dto.ProfileResponse;
import dev.reellab.server.web.dto.UpdateProfileRequest;
import dev.reellab.server.web.dto.UserResponse;
import dev.reellab.server.web.dto.UserSummaryResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService users;
    private final FollowService follows;
    private final MediaUrlAssembler media;

    public UserController(UserService users, FollowService follows, MediaUrlAssembler media) {
        this.users = users;
        this.follows = follows;
        this.media = media;
    }

    @GetMapping
    public List<UserResponse> list() {
        return users.findAll().stream().map(this::toUser).toList();
    }

    /**
     * Find people by handle or display name.
     *
     * <p>Mapped above {@code /{id}} in this file for readability only — Spring matches a
     * literal segment before a template regardless of order, and {@code search} is not a UUID
     * in any case.
     *
     * <p>Open to anyone, like every other GET here: you can see who is on this app before you
     * have an account, which is the same thing the feed already tells you.
     */
    @GetMapping("/search")
    public List<UserSummaryResponse> search(@RequestParam(name = "q", required = false) String q,
                                            @RequestParam(required = false) Integer limit) {
        return users.search(q, limit).stream().map(this::toSummary).toList();
    }

    @GetMapping("/{id}")
    public UserResponse get(@PathVariable UUID id) {
        return toUser(users.require(id));
    }

    /**
     * A user's profile, with their activity counts.
     *
     * <p>Almost identical for everyone who asks. The one thing that differs is
     * {@code followedByViewer} — which is a fact about the ASKER, not about this user, and is
     * the reason the token is read here at all. Everything else is public, and nothing
     * private is returned even on your own profile; see {@link ProfileResponse}.
     *
     * <p>The token is optional: a profile stays readable signed out, and then the one
     * viewer-relative field is simply false.
     */
    @GetMapping("/{id}/profile")
    public ProfileResponse profile(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return toProfile(users.require(id), CurrentUser.idOrNull(jwt));
    }

    /**
     * Follow someone.
     *
     * <p>PUT and DELETE rather than POST, and idempotent both ways, exactly like a like — a
     * Follow button flips before the server has answered, so it has to be safe to replay.
     * See {@link FollowService#follow}.
     */
    @PutMapping("/{id}/follow")
    public FollowResponse follow(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return toFollowResponse(id, follows.follow(CurrentUser.id(jwt), id));
    }

    @DeleteMapping("/{id}/follow")
    public FollowResponse unfollow(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return toFollowResponse(id, follows.unfollow(CurrentUser.id(jwt), id));
    }

    /** Edit a profile. Yours only — the id in the path must be the id in the token. */
    @PatchMapping("/{id}")
    public ProfileResponse updateProfile(@PathVariable UUID id,
                                         @Valid @RequestBody UpdateProfileRequest request,
                                         @AuthenticationPrincipal Jwt jwt) {
        UUID actor = CurrentUser.id(jwt);
        UserService.requireSelf(actor, id, "profile");
        return toProfile(users.updateProfile(
                id, request.displayName(), request.fullName(), request.bio(),
                request.avatarPath()), actor);
    }

    private UserResponse toUser(UserEntity user) {
        return UserResponse.from(user, media.toUrl(user.getAvatarPath()));
    }

    private UserSummaryResponse toSummary(UserEntity user) {
        return new UserSummaryResponse(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getBio(),
                media.toUrl(user.getAvatarPath()));
    }

    private static FollowResponse toFollowResponse(UUID userId, FollowService.FollowState state) {
        return new FollowResponse(
                userId, state.followers(), state.following(), state.followedByViewer());
    }

    private ProfileResponse toProfile(UserEntity user, UUID viewerId) {
        UserService.Activity activity = users.activityOf(user.getId());
        FollowService.FollowState follow = follows.of(user.getId(), viewerId);
        return new ProfileResponse(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getFullName(),
                user.getBio(),
                // Relative path in, absolute URL out — the same composition the feed does.
                media.toUrl(user.getAvatarPath()),
                user.getCreatedAt(),
                new ProfileResponse.ProfileActivity(
                        activity.publishedVideos(),
                        activity.comments(),
                        activity.likesReceived(),
                        follow.followers(),
                        follow.following()),
                follow.followedByViewer());
    }
}
