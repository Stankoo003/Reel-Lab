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

/** One user blocking another. Directional; both directions can exist independently. */
@Entity
@Table(name = "user_blocks")
@EntityListeners(AuditingEntityListener.class)
public class UserBlockEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "blocker_id", nullable = false, updatable = false)
    private UserEntity blocker;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "blocked_id", nullable = false, updatable = false)
    private UserEntity blocked;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected UserBlockEntity() {
        // required by JPA
    }

    public UserBlockEntity(UserEntity blocker, UserEntity blocked) {
        this.blocker = blocker;
        this.blocked = blocked;
    }

    public UUID getId() {
        return id;
    }

    public UserEntity getBlocker() {
        return blocker;
    }

    public UserEntity getBlocked() {
        return blocked;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
