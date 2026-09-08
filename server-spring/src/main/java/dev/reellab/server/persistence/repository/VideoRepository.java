package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.VideoEntity;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface VideoRepository extends JpaRepository<VideoEntity, UUID> {

    // owner is LAZY, so the graph is declared where the owner is actually needed
    // rather than left to be fetched one query per row.
    @EntityGraph(attributePaths = "owner")
    Page<VideoEntity> findByPublishedTrue(Pageable pageable);

    @EntityGraph(attributePaths = "owner")
    Page<VideoEntity> findAllBy(Pageable pageable);

    /**
     * One owner's videos, drafts included.
     *
     * <p>Scoped in the query rather than by filtering a global page client-side: that made
     * "My videos" show only whichever of your videos happened to fall in the newest 50
     * overall, so a user who had not posted recently saw an empty screen reading "Nothing
     * yet" — indistinguishable from data loss.
     */
    @EntityGraph(attributePaths = "owner")
    Page<VideoEntity> findByOwnerId(UUID ownerId, Pageable pageable);

    @EntityGraph(attributePaths = "owner")
    Optional<VideoEntity> findWithOwnerById(UUID id);

    /**
     * First feed page. {@code Limit} rather than {@code Pageable}: a feed never needs
     * the count query that a {@code Page} return type would trigger.
     *
     * <p>id is part of the ordering because created_at is not unique — it defaults to
     * {@code now()}, so rows written in one transaction share it. Without the tie-break
     * the order is not total and a cursor can skip or repeat rows.
     */
    @EntityGraph(attributePaths = "owner")
    List<VideoEntity> findByPublishedTrueOrderByCreatedAtDescIdDesc(Limit limit);

    /**
     * The page after a cursor. This is the one query in the codebase that cannot be
     * derived from a method name: keyset paging needs the row-value comparison
     * {@code (created_at, id) < (:createdAt, :id)}, which JPQL has no syntax for, so it
     * is spelled out as the equivalent disjunction.
     */
    @EntityGraph(attributePaths = "owner")
    @Query("""
            select v from VideoEntity v
            where v.published = true
              and (v.createdAt < :createdAt
                   or (v.createdAt = :createdAt and v.id < :id))
            order by v.createdAt desc, v.id desc
            """)
    List<VideoEntity> findFeedAfter(@Param("createdAt") Instant createdAt,
                                    @Param("id") UUID id,
                                    Limit limit);

    /** Published videos by this owner — the count shown on a profile. */
    long countByOwnerIdAndPublishedTrue(UUID ownerId);
}
