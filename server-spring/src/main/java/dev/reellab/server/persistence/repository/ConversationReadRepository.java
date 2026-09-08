package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.ConversationReadEntity;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ConversationReadRepository
        extends JpaRepository<ConversationReadEntity, ConversationReadEntity.Key> {

    @Query("""
            select r from ConversationReadEntity r
            where r.key.conversationId = :conversationId and r.key.userId = :userId
            """)
    Optional<ConversationReadEntity> find(@Param("conversationId") UUID conversationId,
                                          @Param("userId") UUID userId);

    /** Every watermark this user holds across a set of threads — one query for the list. */
    @Query("""
            select r from ConversationReadEntity r
            where r.key.userId = :userId and r.key.conversationId in :conversationIds
            """)
    List<ConversationReadEntity> findAllForUser(@Param("userId") UUID userId,
                                                @Param("conversationIds") Collection<UUID> conversationIds);

    /** Every watermark held on a set of threads, by anyone — the other side's, for receipts. */
    @Query("""
            select r from ConversationReadEntity r
            where r.key.conversationId in :conversationIds
            """)
    List<ConversationReadEntity> findAllForConversations(
            @Param("conversationIds") Collection<UUID> conversationIds);
}
