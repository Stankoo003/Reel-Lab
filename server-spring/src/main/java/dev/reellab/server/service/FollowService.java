package dev.reellab.server.service;

import dev.reellab.server.persistence.repository.UserFollowRepository;
import dev.reellab.server.service.exception.ValidationException;
import java.util.Collection;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Following and unfollowing.
 *
 * <p>Separate from {@link UserService} rather than folded into it: that class is about an
 * account — who it is, what it may edit. This is about the relationship BETWEEN two
 * accounts, and it is the only thing in the codebase that reads or writes user_follows.
 */
@Service
public class FollowService {

    /** Worded once, so the API and its tests cannot disagree about what happened. */
    public static final String CANNOT_FOLLOW_SELF = "You cannot follow yourself.";

    private final UserFollowRepository follows;
    private final UserService users;

    public FollowService(UserFollowRepository follows, UserService users) {
        this.follows = follows;
        this.users = users;
    }

    /**
     * Follow someone. Idempotent, exactly like a like: following someone you already follow
     * succeeds and changes nothing.
     *
     * <p>That matters more here than it looks. A Follow button is optimistic — it flips the
     * instant it is pressed — so it will replay and race itself on a slow connection.
     * Answering "you already follow them" with an error would make the button flicker back
     * to the wrong state on a retry that in fact succeeded.
     */
    @Transactional
    public FollowState follow(UUID followerId, UUID followeeId) {
        if (followerId.equals(followeeId)) {
            // Checked before the lookups so the message is about what you did, not about a
            // constraint. The database has the same rule — see user_follows_not_self — and
            // that one is the guarantee.
            throw new ValidationException(CANNOT_FOLLOW_SELF);
        }
        // Both looked up so an unknown user is a 404 rather than a foreign-key error.
        users.require(followerId);
        users.require(followeeId);

        follows.insertIgnoringDuplicate(followerId, followeeId);
        return state(followeeId, true);
    }

    /** Unfollow. Idempotent in the same way: unfollowing someone you do not follow is a no-op. */
    @Transactional
    public FollowState unfollow(UUID followerId, UUID followeeId) {
        users.require(followeeId);
        follows.deleteByFollowerIdAndFolloweeId(followerId, followeeId);
        return state(followeeId, false);
    }

    /**
     * The follow counts for one user, and whether the viewer follows them.
     *
     * <p>{@code viewerId} may be null — a profile is public, and "do I follow them" is simply
     * unanswerable when nobody is asking. It comes back false, which is also what it means.
     */
    @Transactional(readOnly = true)
    public FollowState of(UUID userId, UUID viewerId) {
        boolean following = viewerId != null
                && !viewerId.equals(userId)
                && follows.existsByFollowerIdAndFolloweeId(viewerId, userId);
        return state(userId, following);
    }

    /**
     * Which of these users the viewer follows.
     *
     * <p>One query for a whole page of feed videos rather than one per row — the feed labels
     * every clip whose author you follow, and doing that per row is how a feed gets slow.
     */
    @Transactional(readOnly = true)
    public Set<UUID> followedAmong(Collection<UUID> userIds, UUID viewerId) {
        if (viewerId == null || userIds.isEmpty()) {
            return Set.of();
        }
        return Set.copyOf(follows.followedIdsAmong(viewerId, userIds));
    }

    /**
     * The standing of the user this is ABOUT — the one being looked at or followed, never the
     * viewer. Counts are read after the write, so the response is the state that now holds
     * rather than the state the client guessed while its button was already flipped.
     */
    private FollowState state(UUID userId, boolean following) {
        return new FollowState(
                follows.countByFolloweeId(userId), follows.countByFollowerId(userId), following);
    }

    /**
     * One user's follow standing.
     *
     * @param followers how many people follow them
     * @param following how many people they follow
     * @param followedByViewer whether the user who asked follows them
     */
    public record FollowState(long followers, long following, boolean followedByViewer) {
    }
}
