package dev.reellab.server.service;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.repository.CommentRepository;
import dev.reellab.server.persistence.repository.UserRepository;
import dev.reellab.server.persistence.repository.VideoLikeRepository;
import dev.reellab.server.persistence.repository.VideoRepository;
import dev.reellab.server.service.exception.ForbiddenException;
import dev.reellab.server.service.exception.NotFoundException;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    /**
     * Worded once and reused by the web layer's translation of the corresponding unique index,
     * so a caller cannot tell whether it lost the pre-check or the race.
     */
    public static final String USERNAME_TAKEN = "That username is already taken.";

    public static final String EMAIL_TAKEN = "That email is already registered.";

    private final UserRepository users;
    private final VideoRepository videos;
    private final CommentRepository comments;
    private final VideoLikeRepository likes;

    public UserService(UserRepository users, VideoRepository videos, CommentRepository comments,
                       VideoLikeRepository likes) {
        this.users = users;
        this.videos = videos;
        this.comments = comments;
        this.likes = likes;
    }

    @Transactional(readOnly = true)
    public List<UserEntity> findAll() {
        return users.findAll();
    }

    @Transactional(readOnly = true)
    public UserEntity require(UUID id) {
        return users.findById(id).orElseThrow(() -> new NotFoundException("User", id));
    }

    /**
     * Update the editable parts of a profile.
     *
     * <p>Username and email are not editable here on purpose: one identifies the account and
     * the other has no route through this API at all.
     *
     * <p>There is no authentication yet, so this service cannot tell whose profile it is and
     * any caller may edit any profile. "You may only edit your own" is a rule the UI applies
     * — the same arrangement as editing a video or a comment — and it becomes enforceable
     * here the moment auth lands.
     */
    @Transactional
    public UserEntity updateProfile(UUID id, String displayName, String bio, String avatarPath) {
        UserEntity user = require(id);
        user.setDisplayName(displayName);
        // Absent and blank mean different things, as they must on a PATCH: a field the client
        // did not send is a field it has no opinion about, so leaving it out cannot be allowed
        // to delete it. An explicit empty string is how a bio gets removed. avatarPath below
        // has always worked this way; the bio did not, and silently wiped itself whenever a
        // client sent only a display name.
        if (bio != null) {
            user.setBio(bio.isBlank() ? null : bio);
        }
        if (avatarPath != null) {
            MediaPaths.requireRelative("avatarPath", avatarPath);
            user.setAvatarPath(avatarPath.isBlank() ? null : avatarPath);
        }
        return user;
    }

    /**
     * What this user has done here. Counts only — a profile says how much, never what, so
     * nothing private leaks through the shape of someone's activity.
     */
    @Transactional(readOnly = true)
    public Activity activityOf(UUID id) {
        return new Activity(
                videos.countByOwnerIdAndPublishedTrue(id),
                comments.countByAuthorId(id),
                likes.countByVideoOwnerId(id));
    }

    /** Counts for one profile. Plain data — no JPA, no HTTP. */
    public record Activity(long publishedVideos, long comments, long likesReceived) {
    }

    /**
     * Whether this user may change that resource.
     *
     * <p>The rule the whole API rests on now that identity is proven rather than asserted:
     * you may only change your own things. Kept here rather than repeated in each service so
     * "is it mine" has one definition.
     */
    public static void requireSelf(UUID actor, UUID owner, String what) {
        if (!actor.equals(owner)) {
            throw new ForbiddenException("That " + what + " is not yours to change.");
        }
    }
}
