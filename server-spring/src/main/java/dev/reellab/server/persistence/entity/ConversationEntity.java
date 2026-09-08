package dev.reellab.server.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

/**
 * A 1:1 thread.
 *
 * <p>Two participant columns, not a participants table — see V10__messaging.sql. The pair is
 * stored in a canonical order so that (a,b) and (b,a) are the same row, which is what makes
 * the unique constraint mean "one conversation per pair".
 */
@Entity
@Table(name = "conversations")
@EntityListeners(AuditingEntityListener.class)
public class ConversationEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_a_id", nullable = false, updatable = false)
    private UserEntity userA;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_b_id", nullable = false, updatable = false)
    private UserEntity userB;

    @Column(name = "last_message_at")
    private Instant lastMessageAt;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected ConversationEntity() {
        // required by JPA
    }

    /**
     * @param first either participant — the constructor puts them in canonical order, so no
     *     caller has to remember to
     */
    public ConversationEntity(UserEntity first, UserEntity second) {
        boolean ordered = compare(first.getId(), second.getId()) < 0;
        this.userA = ordered ? first : second;
        this.userB = ordered ? second : first;
    }

    /**
     * Orders two ids the way POSTGRES orders them, which is not the way Java does.
     *
     * <p>{@code UUID.compareTo} compares the two halves as SIGNED longs, so any id whose
     * high bit is set sorts before every id whose is not. Postgres compares the sixteen bytes
     * unsigned. Using Java's ordering here produced rows that the {@code conversations_ordered}
     * check constraint rejected — roughly half the time, depending on which random ids the
     * two users happened to have, which is the worst possible failure rate to debug.
     *
     * <p>Unsigned comparison of the same two longs matches the byte order exactly.
     */
    public static int compare(UUID left, UUID right) {
        int high = Long.compareUnsigned(
                left.getMostSignificantBits(), right.getMostSignificantBits());
        return high != 0 ? high
                : Long.compareUnsigned(
                        left.getLeastSignificantBits(), right.getLeastSignificantBits());
    }

    public UUID getId() {
        return id;
    }

    public UserEntity getUserA() {
        return userA;
    }

    public UserEntity getUserB() {
        return userB;
    }

    /** The participant who is not this one. */
    public UserEntity other(UUID viewerId) {
        return userA.getId().equals(viewerId) ? userB : userA;
    }

    /**
     * The authorization question, answered by the row itself.
     *
     * <p>Everything that reads or writes a thread asks this first, and it is the only
     * definition of "may see this conversation" in the codebase.
     */
    public boolean includes(UUID userId) {
        return userA.getId().equals(userId) || userB.getId().equals(userId);
    }

    public Instant getLastMessageAt() {
        return lastMessageAt;
    }

    public void touch(Instant at) {
        this.lastMessageAt = at;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
