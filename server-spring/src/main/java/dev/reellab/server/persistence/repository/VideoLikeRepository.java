package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.VideoLikeEntity;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface VideoLikeRepository extends JpaRepository<VideoLikeEntity, UUID> {

    boolean existsByVideoIdAndUserId(UUID videoId, UUID userId);

    /**
     * Insert a like, doing nothing if this user already liked this video.
     *
     * <p>Native, because ON CONFLICT is the whole point and JPQL cannot express it. Catching
     * the constraint violation in Java instead does not work: Postgres aborts the transaction
     * the moment the violation fires, so every later statement — including the one that would
     * check whether the row now exists — fails with {@code 25P02}, and Hibernate has already
     * marked the transaction rollback-only. ON CONFLICT means no exception is ever raised, so
     * idempotency belongs to the database rather than to a {@code catch} block that cannot run.
     *
     * @return 1 if a row was inserted, 0 if the like was already there
     */
    @Modifying
    @Query(value = """
            insert into video_likes (video_id, user_id)
            values (:videoId, :userId)
            on conflict (user_id, video_id) do nothing
            """, nativeQuery = true)
    int insertIgnoringDuplicate(@Param("videoId") UUID videoId, @Param("userId") UUID userId);

    /** Returns how many rows were removed, which is how unlike reports whether it did anything. */
    @Modifying
    long deleteByVideoIdAndUserId(UUID videoId, UUID userId);

    long countByVideoId(UUID videoId);

    /** Likes across everything this user owns — "likes received", not "likes given". */
    long countByVideoOwnerId(UUID ownerId);

    /**
     * Like counts for a whole page of videos in one query.
     *
     * <p>Videos with no likes are simply absent from the result — the caller defaults them
     * to zero rather than this having to left-join a table it does not own.
     */
    @Query("""
            select l.video.id, count(l)
            from VideoLikeEntity l
            where l.video.id in :videoIds
            group by l.video.id
            """)
    List<Object[]> countsByVideoIds(@Param("videoIds") Collection<UUID> videoIds);

    /** Which of these videos the viewer has liked — one query, not one per row. */
    @Query("""
            select l.video.id
            from VideoLikeEntity l
            where l.user.id = :userId and l.video.id in :videoIds
            """)
    List<UUID> likedVideoIds(@Param("userId") UUID userId,
                             @Param("videoIds") Collection<UUID> videoIds);
}
