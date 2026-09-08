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
 * One user following another.
 *
 * <p>Same shape as {@link VideoLikeEntity}, for the same reason: the follow IS the row. There
 * is no boolean to flip and no {@code updatedAt}, so the unique constraint on
 * (follower_id, followee_id) means exactly "you either follow someone or you do not".
 *
 * <p>The two sides are named rather than symmetric — following is not mutual, and calling
 * them {@code follower} and {@code followee} keeps every query unambiguous about which
 * direction it is asking in.
 */
@Entity
@Table(name = "user_follows")
@EntityListeners(AuditingEntityListener.class)
public class UserFollowEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "follower_id", nullable = false, updatable = false)
    private UserEntity follower;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "followee_id", nullable = false, updatable = false)
    private UserEntity followee;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected UserFollowEntity() {
        // required by JPA
    }

    public UserFollowEntity(UserEntity follower, UserEntity followee) {
        this.follower = follower;
        this.followee = followee;
    }

    public UUID getId() {
        return id;
    }

    public UserEntity getFollower() {
        return follower;
    }

    public UserEntity getFollowee() {
        return followee;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
