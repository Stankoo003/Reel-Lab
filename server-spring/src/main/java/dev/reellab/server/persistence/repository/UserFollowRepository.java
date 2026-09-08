package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.UserFollowEntity;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserFollowRepository extends JpaRepository<UserFollowEntity, UUID> {

    boolean existsByFollowerIdAndFolloweeId(UUID followerId, UUID followeeId);

    /**
     * Follow, doing nothing if the follow is already there.
     *
     * <p>Native for the same reason as {@code VideoLikeRepository.insertIgnoringDuplicate}:
     * ON CONFLICT cannot be written in JPQL, and catching the constraint violation in Java
     * is not an option because Postgres aborts the transaction the moment it fires — every
     * later statement, including the one that would check whether the row now exists, then
     * fails with 25P02. Idempotency belongs to the database here, not to a catch block.
     *
     * @return 1 if a row was inserted, 0 if the follow already existed
     */
    @Modifying
    @Query(value = """
            insert into user_follows (follower_id, followee_id)
            values (:followerId, :followeeId)
            on conflict (follower_id, followee_id) do nothing
            """, nativeQuery = true)
    int insertIgnoringDuplicate(@Param("followerId") UUID followerId,
                                @Param("followeeId") UUID followeeId);

    /** How many rows were removed — how unfollow reports whether it did anything. */
    @Modifying
    long deleteByFollowerIdAndFolloweeId(UUID followerId, UUID followeeId);

    /** People who follow this user. */
    long countByFolloweeId(UUID followeeId);

    /** People this user follows. */
    long countByFollowerId(UUID followerId);

    /**
     * Which of these users the viewer follows — one query for a whole page of videos, not
     * one per row. Same shape as {@code likedVideoIds}.
     */
    @Query("""
            select f.followee.id
            from UserFollowEntity f
            where f.follower.id = :followerId and f.followee.id in :followeeIds
            """)
    List<UUID> followedIdsAmong(@Param("followerId") UUID followerId,
                                @Param("followeeIds") Collection<UUID> followeeIds);
}
