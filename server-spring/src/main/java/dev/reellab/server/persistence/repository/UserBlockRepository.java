package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.UserBlockEntity;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserBlockRepository extends JpaRepository<UserBlockEntity, UUID> {

    boolean existsByBlockerIdAndBlockedId(UUID blockerId, UUID blockedId);

    @Modifying
    long deleteByBlockerIdAndBlockedId(UUID blockerId, UUID blockedId);

    /** Fetch-joined: the caller renders who was blocked, outside the transaction. */
    @Query("select b from UserBlockEntity b join fetch b.blocked where b.blocker.id = :blockerId")
    List<UserBlockEntity> findAllByBlockerId(@Param("blockerId") UUID blockerId);

    /**
     * Whether a block exists in EITHER direction between two people.
     *
     * <p>One query rather than two, and both directions rather than one, because the rule is
     * symmetric in effect: if I blocked you, I do not want your messages; if you blocked me,
     * you should not have to receive mine. A one-directional check lets the blocked party
     * keep writing into a thread the blocker is still holding open.
     */
    @Query("""
            select count(b) > 0 from UserBlockEntity b
            where (b.blocker.id = :one and b.blocked.id = :other)
               or (b.blocker.id = :other and b.blocked.id = :one)
            """)
    boolean blockExistsBetween(@Param("one") UUID one, @Param("other") UUID other);
}
