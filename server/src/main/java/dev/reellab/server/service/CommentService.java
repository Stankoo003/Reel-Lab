package dev.reellab.server.service;

import dev.reellab.server.persistence.entity.CommentEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.persistence.repository.CommentRepository;
import dev.reellab.server.service.exception.ConflictException;
import dev.reellab.server.service.exception.NotFoundException;
import dev.reellab.server.service.exception.ValidationException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CommentService {

    /**
     * Kept identical to the message the database's own violation is translated into, so a
     * caller cannot tell whether it lost the pre-check or the race.
     */
    public static final String ALREADY_COMMENTED =
            "You have already commented on this video. Edit your existing comment instead.";

    public static final String ALREADY_REPLIED =
            "You have already replied to this comment. Edit your existing reply instead.";

    /**
     * For a lost race, where the constraint fired and nothing here knows whether the attempt
     * was a top-level comment or a reply — {@code comments_one_per_author_uq} covers both.
     * Deliberately true of either case rather than guessing and naming the wrong one.
     */
    public static final String ALREADY_COMMENTED_OR_REPLIED =
            "You have already posted here. Edit your existing comment instead.";

    private final CommentRepository comments;
    private final VideoService videoService;
    private final UserService userService;

    public CommentService(CommentRepository comments, VideoService videoService,
                          UserService userService) {
        this.comments = comments;
        this.videoService = videoService;
        this.userService = userService;
    }

    /**
     * A page of a thread: top-level comments plus their direct replies.
     *
     * <p>The schema allows arbitrary nesting, but the API stops at two levels on purpose —
     * an unbounded recursive response is an availability problem. Two queries per page,
     * regardless of how many comments there are.
     *
     * <p>Only the roots are paginated. Replies to the roots on this page come back whole,
     * because a reply is capped at one per author per parent — the fan-out is bounded by
     * the number of users, and splitting it would make a two-level thread need N+1 requests
     * to read.
     */
    @Transactional(readOnly = true)
    public Thread threadFor(UUID videoId, Instant cursorCreatedAt, UUID cursorId, int limit) {
        videoService.require(videoId);

        // One row more than asked for: its presence is what says there is a next page,
        // without a count over the whole thread.
        Limit fetch = Limit.of(limit + 1);
        List<CommentEntity> rows = cursorCreatedAt == null
                ? comments.findByVideoIdAndParentIsNullOrderByCreatedAtAscIdAsc(videoId, fetch)
                : comments.findRootsAfter(videoId, cursorCreatedAt, cursorId, fetch);

        boolean hasNext = rows.size() > limit;
        List<CommentEntity> roots = hasNext ? List.copyOf(rows.subList(0, limit)) : List.copyOf(rows);
        if (roots.isEmpty()) {
            return new Thread(List.of(), Map.of(), false);
        }

        List<UUID> rootIds = roots.stream().map(CommentEntity::getId).toList();
        Map<UUID, List<CommentEntity>> replies = comments.findByParentIdInOrderByCreatedAtAsc(rootIds)
                .stream()
                .collect(Collectors.groupingBy(c -> c.getParent().getId()));
        return new Thread(roots, replies, hasNext);
    }

    /**
     * Add a comment or a reply.
     *
     * <p>The one-per-author rule is checked here so the caller gets a clear 409 instead of a
     * constraint violation, but the check is a courtesy, not the guarantee: two concurrent
     * requests both pass it. {@code comments_one_per_author_uq} is what actually enforces
     * it, and the web layer translates that violation into the same 409.
     */
    @Transactional
    public CommentEntity add(UUID videoId, UUID authorId, UUID parentId, String body) {
        VideoEntity video = videoService.require(videoId);
        UserEntity author = userService.require(authorId);

        CommentEntity parent = null;
        if (parentId != null) {
            parent = comments.findById(parentId)
                    .orElseThrow(() -> new NotFoundException("Comment", parentId));
            if (!parent.getVideo().getId().equals(videoId)) {
                // Also enforced by the composite foreign key; caught here to give a
                // usable message rather than a raw constraint violation.
                throw new ValidationException("Parent comment belongs to a different video");
            }
            if (parent.getParent() != null) {
                throw new ValidationException("Replies are limited to one level");
            }
            if (comments.existsByVideoIdAndAuthorIdAndParentId(videoId, authorId, parentId)) {
                throw new ConflictException(ALREADY_REPLIED);
            }
        } else if (comments.existsByVideoIdAndAuthorIdAndParentIsNull(videoId, authorId)) {
            throw new ConflictException(ALREADY_COMMENTED);
        }

        return comments.save(new CommentEntity(video, author, parent, body));
    }

    /**
     * Change the text of an existing comment.
     *
     * <p>Deliberately an update, not a delete-and-add: it touches no key of
     * {@code comments_one_per_author_uq}, so it cannot collide with the one-per-author rule.
     * That is what makes "you get one comment, but you may edit it" a coherent offer.
     *
     * <p>Only the author may edit. The identity is the token's, not the request's, so this
     * is now a rule the server enforces rather than one the UI merely applies.
     */
    @Transactional
    public Edited edit(UUID id, String body, UUID actor) {
        // With the author, because the caller renders it and open-in-view is off — and
        // because the ownership check below needs it loaded.
        CommentEntity comment = comments.findWithAuthorById(id)
                .orElseThrow(() -> new NotFoundException("Comment", id));
        UserService.requireSelf(actor, comment.getAuthor().getId(), "comment");
        comment.setBody(body);
        // A root is rendered with its replies, so an edit has to hand them back or the caller
        // cannot patch its response into the thread without losing them. A reply has none.
        List<CommentEntity> replies = comment.getParent() == null
                ? comments.findByParentIdInOrderByCreatedAtAsc(List.of(id))
                : List.of();
        return new Edited(comment, replies);
    }

    @Transactional
    public void delete(UUID id, UUID actor) {
        CommentEntity comment = comments.findWithAuthorById(id)
                .orElseThrow(() -> new NotFoundException("Comment", id));
        UserService.requireSelf(actor, comment.getAuthor().getId(), "comment");
        // Replies cascade with the parent, in the database. Deleting your own root therefore
        // removes other people's replies to it — the same trade the schema already made.
        comments.delete(comment);
    }

    /** An edited comment and, if it is a root, the replies it still has. */
    public record Edited(CommentEntity comment, List<CommentEntity> replies) {
    }

    /** One page of a two-level comment thread. Plain data — no JPA, no HTTP. */
    public record Thread(List<CommentEntity> roots,
                         Map<UUID, List<CommentEntity>> repliesByParent,
                         boolean hasNext) {

        public List<CommentEntity> repliesTo(UUID rootId) {
            return repliesByParent.getOrDefault(rootId, List.of());
        }
    }
}
