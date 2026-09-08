package dev.reellab.server.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;
import jakarta.persistence.EntityListeners;

@Entity
@Table(name = "users")
@EntityListeners(AuditingEntityListener.class)
public class UserEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(nullable = false, length = 50)
    private String username;

    @Column(nullable = false, length = 255)
    private String email;

    @Column(name = "display_name", nullable = false, length = 100)
    private String displayName;

    /**
     * BCrypt. Never the password itself, and never returned by any endpoint — see
     * ProfileIntegrationTest, which asserts that across the whole API.
     */
    @Column(name = "password_hash", nullable = false, length = 100)
    private String passwordHash;

    @Column(columnDefinition = "text")
    private String bio;

    /**
     * Their real name, if they gave one.
     *
     * <p>Not the same field as {@link #displayName} and not derived from it: the display name
     * is what the app shows, and it can be a handle, a band name or a joke. This is who they
     * actually are, and it is optional because nobody owes it.
     */
    @Column(name = "full_name", length = 100)
    private String fullName;

    /** Relative path, like videos.manifest_path. Never a URL — the database rejects one. */
    @Column(name = "avatar_path", length = 500)
    private String avatarPath;

    /**
     * When this account's password last changed.
     *
     * <p>Sessions are stateless JWTs — there is no session table to delete from — so this is
     * what invalidates them. Every token issued before this instant is refused; see
     * {@code PasswordChangeTokenValidator}. Resetting a password therefore signs out every
     * device, which is the entire point of resetting one you think someone else has.
     */
    @Column(name = "password_changed_at", nullable = false)
    private Instant passwordChangedAt = Instant.now();

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected UserEntity() {
        // required by JPA
    }

    public UserEntity(String username, String email, String displayName, String passwordHash) {
        this.username = username;
        this.email = email;
        this.displayName = displayName;
        this.passwordHash = passwordHash;
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getEmail() {
        return email;
    }

    public String getDisplayName() {
        return displayName;
    }

    /** Read by AuthService to verify a login, and by nothing else. */
    public String getPasswordHash() {
        return passwordHash;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public String getBio() {
        return bio;
    }

    public void setBio(String bio) {
        this.bio = bio;
    }

    public String getAvatarPath() {
        return avatarPath;
    }

    public void setAvatarPath(String avatarPath) {
        this.avatarPath = avatarPath;
    }

    public Instant getPasswordChangedAt() {
        return passwordChangedAt;
    }

    /** Both together, always: a new hash without a new instant leaves old tokens working. */
    public void changePassword(String passwordHash, Instant changedAt) {
        this.passwordHash = passwordHash;
        this.passwordChangedAt = changedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
