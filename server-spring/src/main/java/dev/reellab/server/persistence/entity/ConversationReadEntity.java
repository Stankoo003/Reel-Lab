package dev.reellab.server.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * How far one participant has read one thread.
 *
 * <p>A watermark rather than a per-message flag: unread is then a COUNT of messages newer
 * than an instant, which stays one indexed query however long the thread grows.
 */
@Entity
@Table(name = "conversation_reads")
public class ConversationReadEntity {

    @EmbeddedId
    private Key key;

    @Column(name = "last_read_at", nullable = false)
    private Instant lastReadAt;

    /**
     * How far the participant's device has RECEIVED the thread — the second tick.
     *
     * <p>Never earlier than {@link #lastReadAt}: reading a message means it arrived.
     */
    @Column(name = "last_delivered_at", nullable = false)
    private Instant lastDeliveredAt;

    protected ConversationReadEntity() {
        // required by JPA
    }

    public ConversationReadEntity(UUID conversationId, UUID userId, Instant lastReadAt) {
        this.key = new Key(conversationId, userId);
        this.lastReadAt = lastReadAt;
        this.lastDeliveredAt = lastReadAt;
    }

    /** A row for a participant who has received the thread but not opened it. */
    public static ConversationReadEntity delivered(UUID conversationId, UUID userId, Instant at) {
        ConversationReadEntity row = new ConversationReadEntity();
        row.key = new Key(conversationId, userId);
        row.lastReadAt = Instant.EPOCH;
        row.lastDeliveredAt = at;
        return row;
    }

    public UUID getConversationId() {
        return key.getConversationId();
    }

    public UUID getUserId() {
        return key.getUserId();
    }

    /** Null when the participant has never opened the thread. */
    public Instant getLastReadAt() {
        return Instant.EPOCH.equals(lastReadAt) ? null : lastReadAt;
    }

    public Instant getLastDeliveredAt() {
        return lastDeliveredAt;
    }

    /** True when something moved. */
    public boolean markRead(Instant at) {
        boolean moved = false;
        // Never backwards: two devices reading the same thread must not undo each other.
        if (lastReadAt == null || at.isAfter(lastReadAt)) {
            this.lastReadAt = at;
            moved = true;
        }
        // Reading a message means it arrived, whatever the device managed to say before.
        return markDelivered(at) || moved;
    }

    /** True when something moved. */
    public boolean markDelivered(Instant at) {
        if (lastDeliveredAt == null || at.isAfter(lastDeliveredAt)) {
            this.lastDeliveredAt = at;
            return true;
        }
        return false;
    }

    @Embeddable
    public static class Key implements Serializable {

        @Column(name = "conversation_id", nullable = false)
        private UUID conversationId;

        @Column(name = "user_id", nullable = false)
        private UUID userId;

        protected Key() {
            // required by JPA
        }

        public Key(UUID conversationId, UUID userId) {
            this.conversationId = conversationId;
            this.userId = userId;
        }

        public UUID getConversationId() {
            return conversationId;
        }

        public UUID getUserId() {
            return userId;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            return o instanceof Key other
                    && Objects.equals(conversationId, other.conversationId)
                    && Objects.equals(userId, other.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(conversationId, userId);
        }
    }
}
