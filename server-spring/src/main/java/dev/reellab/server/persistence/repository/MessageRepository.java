package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.MessageEntity;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Every query that reaches a client also fetches the shared clip and its owner. The message
 * card is composed in the web layer, outside any transaction (open-in-view is off), and a
 * lazy clip touched there is an exception rather than a title.
 */
public interface MessageRepository extends JpaRepository<MessageEntity, UUID> {

    /**
     * The newest page of a thread.
     *
     * <p>Keyset, not offset — the same choice as the feed, and it matters more here: messages
     * arrive WHILE the reader is scrolling, and every insert shifts an offset page by one,
     * which is exactly how a paginated chat shows you the same message twice and skips
     * another.
     */
    @Query("""
            select m from MessageEntity m
            left join fetch m.video v left join fetch v.owner
            where m.conversation.id = :conversationId
            order by m.createdAt desc, m.id desc
            """)
    List<MessageEntity> newestPage(@Param("conversationId") UUID conversationId, Pageable page);

    /**
     * The page before a cursor — older messages, as the reader scrolls up.
     *
     * <p>The tuple comparison is what makes it exact: ordering by timestamp alone would
     * either repeat or skip messages that share a millisecond, and in a chat two messages
     * sharing a millisecond is a thing that happens.
     */
    @Query("""
            select m from MessageEntity m
            left join fetch m.video v left join fetch v.owner
            where m.conversation.id = :conversationId
              and (m.createdAt < :beforeAt or (m.createdAt = :beforeAt and m.id < :beforeId))
            order by m.createdAt desc, m.id desc
            """)
    List<MessageEntity> pageBefore(@Param("conversationId") UUID conversationId,
                                   @Param("beforeAt") Instant beforeAt,
                                   @Param("beforeId") UUID beforeId,
                                   Pageable page);

    /**
     * Everything that arrived after a moment, oldest first.
     *
     * <p>What a client asks for when its socket comes back: "I have up to here — what did I
     * miss?" Reconciling from the server rather than trusting the socket to have delivered
     * everything is the difference between a gap and a gap you never notice.
     */
    @Query("""
            select m from MessageEntity m
            left join fetch m.video v left join fetch v.owner
            where m.conversation.id = :conversationId and m.createdAt > :after
            order by m.createdAt asc, m.id asc
            """)
    List<MessageEntity> since(@Param("conversationId") UUID conversationId,
                              @Param("after") Instant after,
                              Pageable page);

    /**
     * Unread for a participant who has read part of the thread.
     *
     * <p>Two methods rather than one with a nullable parameter: {@code (:since is null or
     * m.createdAt > :since)} sends an untyped null to Postgres, which answers "could not
     * determine data type of parameter $3" and means it. Casting in the query would work; two
     * queries say what they do and each one plans better.
     */
    @Query("""
            select count(m) from MessageEntity m
            where m.conversation.id = :conversationId
              and m.sender.id <> :userId
              and m.createdAt > :since
            """)
    long countUnreadSince(@Param("conversationId") UUID conversationId,
                          @Param("userId") UUID userId,
                          @Param("since") Instant since);

    /** Unread for a participant who has never opened the thread: everything from them. */
    @Query("""
            select count(m) from MessageEntity m
            where m.conversation.id = :conversationId and m.sender.id <> :userId
            """)
    long countUnreadAll(@Param("conversationId") UUID conversationId,
                        @Param("userId") UUID userId);

    /**
     * The last message of each of these threads, for the conversation list.
     *
     * <p>One query for the whole list rather than one per row. Ties on the timestamp — two
     * messages in the same microsecond — are broken in the caller by ordering ascending and
     * letting the later id win, which is deterministic without a second correlated subquery.
     */
    @Query("""
            select m from MessageEntity m
            left join fetch m.video v left join fetch v.owner
            where m.conversation.id in :conversationIds
              and m.createdAt = (
                  select max(newest.createdAt) from MessageEntity newest
                  where newest.conversation.id = m.conversation.id)
            order by m.id asc
            """)
    List<MessageEntity> lastMessagesOf(@Param("conversationIds") Collection<UUID> conversationIds);

    /** How many messages this user has sent since a moment — the per-user rate limit. */
    long countBySenderIdAndCreatedAtAfter(UUID senderId, Instant since);
}
