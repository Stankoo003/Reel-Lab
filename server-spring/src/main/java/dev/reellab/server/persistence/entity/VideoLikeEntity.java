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
 * One user liking one video.
 *
 * <p>A like is a row's existence, not a flag: unliking deletes it and liking again inserts a
 * new one. That is why there is no {@code updatedAt} here and no boolean to toggle — the
 * unique constraint on (user_id, video_id) then means exactly "one like per user per video"
 * without having to reason about a state machine.
 */
@Entity
@Table(name = "video_likes")
@EntityListeners(AuditingEntityListener.class)
public class VideoLikeEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "video_id", nullable = false, updatable = false)
    private VideoEntity video;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, updatable = false)
    private UserEntity user;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected VideoLikeEntity() {
        // required by JPA
    }

    public VideoLikeEntity(VideoEntity video, UserEntity user) {
        this.video = video;
        this.user = user;
    }

    public UUID getId() {
        return id;
    }

    public VideoEntity getVideo() {
        return video;
    }

    public UserEntity getUser() {
        return user;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
