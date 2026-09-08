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

/** One message. Plain text, stored exactly as sent. */
@Entity
@Table(name = "messages")
@EntityListeners(AuditingEntityListener.class)
public class MessageEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "conversation_id", nullable = false, updatable = false)
    private ConversationEntity conversation;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sender_id", nullable = false, updatable = false)
    private UserEntity sender;

    /**
     * Stored verbatim.
     *
     * <p>Nothing escapes, strips or rewrites this on the way in, and nothing interprets it on
     * the way out — React Native's Text renders its content literally, and the web fallback
     * has no message rendering at all. Escaping here would corrupt a message that legitimately
     * contains {@code <b>}; the safety comes from never handing it to a markup parser.
     */
    @Column(nullable = false, length = 4000)
    private String body;

    /**
     * A shared clip, or null for a plain message.
     *
     * <p>A reference rather than a snapshot: the thread shows the clip as it is now. Set to
     * null by the database when the clip is deleted, and the message stays — the client
     * then says the video is gone rather than losing a line of the conversation.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "video_id")
    private VideoEntity video;

    /** Whether a clip was attached when sent — outlives the clip, which the reference does not. */
    @Column(name = "had_video", nullable = false)
    private boolean hadVideo;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected MessageEntity() {
        // required by JPA
    }

    public MessageEntity(ConversationEntity conversation, UserEntity sender, String body) {
        this(conversation, sender, body, null);
    }

    public MessageEntity(ConversationEntity conversation, UserEntity sender, String body,
                         VideoEntity video) {
        this.conversation = conversation;
        this.sender = sender;
        this.body = body;
        this.video = video;
        this.hadVideo = video != null;
    }

    public UUID getId() {
        return id;
    }

    public ConversationEntity getConversation() {
        return conversation;
    }

    public UserEntity getSender() {
        return sender;
    }

    public String getBody() {
        return body;
    }

    /** Null for a plain message, and for one whose clip has since been deleted. */
    public VideoEntity getVideo() {
        return video;
    }

    /** Whether the clip is attached AND still exists. */
    public boolean hasVideo() {
        return video != null;
    }

    /** A clip was shared here and has since been deleted. */
    public boolean wasVideoRemoved() {
        return hadVideo && video == null;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
