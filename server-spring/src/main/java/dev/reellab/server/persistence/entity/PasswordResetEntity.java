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
 * One outstanding password reset.
 *
 * <p>The token itself is never here — only its SHA-256. See V9__password_resets.sql for why
 * that hash and not bcrypt.
 */
@Entity
@Table(name = "password_resets")
@EntityListeners(AuditingEntityListener.class)
public class PasswordResetEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, updatable = false)
    private UserEntity user;

    @Column(name = "token_hash", nullable = false, updatable = false, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "requested_ip", updatable = false, length = 45)
    private String requestedIp;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected PasswordResetEntity() {
        // required by JPA
    }

    public PasswordResetEntity(UserEntity user, String tokenHash, Instant expiresAt,
                               String requestedIp) {
        this.user = user;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.requestedIp = requestedIp;
    }

    public UUID getId() {
        return id;
    }

    public UserEntity getUser() {
        return user;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getConsumedAt() {
        return consumedAt;
    }

    /** Spent. Once set, this row can never authorise another password change. */
    public void consume(Instant at) {
        this.consumedAt = at;
    }

    public boolean isUsable(Instant now) {
        return consumedAt == null && expiresAt.isAfter(now);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
