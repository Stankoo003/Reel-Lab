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
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

@Entity
@Table(name = "videos")
@EntityListeners(AuditingEntityListener.class)
public class VideoEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    // LAZY everywhere: open-in-view is off, so anything the response needs must be
    // fetched deliberately inside a transaction rather than by accident during
    // serialization.
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_id", nullable = false, updatable = false)
    private UserEntity owner;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(columnDefinition = "text")
    private String description;

    @Column(name = "duration_seconds", nullable = false)
    private int durationSeconds;

    /** Relative path. Never a full URL — the database rejects one. */
    @Column(name = "manifest_path", nullable = false, length = 500)
    private String manifestPath;

    /** Relative path, optional. */
    @Column(name = "poster_path", length = 500)
    private String posterPath;

    @Column(nullable = false)
    private boolean published;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected VideoEntity() {
        // required by JPA
    }

    public VideoEntity(UserEntity owner, String title, String description, int durationSeconds,
                       String manifestPath, String posterPath) {
        this.owner = owner;
        this.title = title;
        this.description = description;
        this.durationSeconds = durationSeconds;
        this.manifestPath = manifestPath;
        this.posterPath = posterPath;
        this.published = false;
    }

    public UUID getId() {
        return id;
    }

    public UserEntity getOwner() {
        return owner;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public int getDurationSeconds() {
        return durationSeconds;
    }

    public String getManifestPath() {
        return manifestPath;
    }

    public String getPosterPath() {
        return posterPath;
    }

    public boolean isPublished() {
        return published;
    }

    public void setPublished(boolean published) {
        this.published = published;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
