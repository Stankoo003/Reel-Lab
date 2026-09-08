package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.CommentEntity;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommentRepository extends JpaRepository<CommentEntity, UUID> {

    /**
     * First page of top-level comments, oldest first — a thread reads in the order it was
     * written, unlike the feed. id completes the ordering because created_at is not unique.
     */
    @EntityGraph(attributePaths = "author")
    List<CommentEntity> findByVideoIdAndParentIsNullOrderByCreatedAtAscIdAsc(UUID videoId,
                                                                             Limit limit);

    /**
     * The page after a cursor. Keyset, spelled out as a disjunction because JPQL has no
     * row-value comparison — same shape as VideoRepository.findFeedAfter, mirrored to
     * ascending order.
     */
    @EntityGraph(attributePaths = "author")
    @Query("""
            select c from CommentEntity c
            where c.video.id = :videoId
              and c.parent is null
              and (c.createdAt > :createdAt
                   or (c.createdAt = :createdAt and c.id > :id))
            order by c.createdAt asc, c.id asc
            """)
    List<CommentEntity> findRootsAfter(@Param("videoId") UUID videoId,
                                       @Param("createdAt") Instant createdAt,
                                       @Param("id") UUID id,
                                       Limit limit);

    /**
     * Direct replies to the given parents, in one query. The API exposes two levels,
     * so this is the second and last level — no recursion.
     */
    @EntityGraph(attributePaths = "author")
    List<CommentEntity> findByParentIdInOrderByCreatedAtAsc(List<UUID> parentIds);

    long countByAuthorId(UUID authorId);

    /**
     * A comment with its author already loaded.
     *
     * <p>Needed because open-in-view is off: an entity handed back from a service has no
     * session behind it, so a lazy author would fail when the web layer maps it.
     */
    @EntityGraph(attributePaths = "author")
    java.util.Optional<CommentEntity> findWithAuthorById(UUID id);

    /**
     * Has this author already left a top-level comment on this video?
     *
     * <p>Spelled out as its own method rather than passing null to the parentId variant:
     * a null argument in a derived query compares with {@code =}, which never matches a
     * NULL column, so the check would silently always say no.
     */
    boolean existsByVideoIdAndAuthorIdAndParentIsNull(UUID videoId, UUID authorId);

    /** Has this author already replied to this particular comment? */
    boolean existsByVideoIdAndAuthorIdAndParentId(UUID videoId, UUID authorId, UUID parentId);
}
