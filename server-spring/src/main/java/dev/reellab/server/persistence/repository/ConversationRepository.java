package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.ConversationEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ConversationRepository extends JpaRepository<ConversationEntity, UUID> {

    /** The pair is stored in canonical order, so the caller passes the smaller id first. */
    Optional<ConversationEntity> findByUserAIdAndUserBId(UUID userAId, UUID userBId);

    /**
     * Every thread this user is in, newest activity first.
     *
     * <p>A conversation with no messages yet sorts last rather than being dropped: it exists
     * because somebody opened it, and hiding it would make "start a chat" look broken.
     */
    // Both participants are fetch-joined because the caller renders them: open-in-view is
    // off, so a lazy proxy touched after the transaction ends is a LazyInitializationException
    // rather than a quiet extra query.
    @Query("""
            select c from ConversationEntity c
            join fetch c.userA
            join fetch c.userB
            where c.userA.id = :userId or c.userB.id = :userId
            order by c.lastMessageAt desc nulls last, c.createdAt desc
            """)
    List<ConversationEntity> findAllForUser(@Param("userId") UUID userId);
}
