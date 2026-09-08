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
 * A reported message, and who reported it.
 *
 * <p>The body is copied rather than only referenced. A report is a record of what somebody
 * saw; if the only copy lived on the message row, editing or deleting the message would
 * quietly empty the complaint about it.
 */
@Entity
@Table(name = "message_reports")
@EntityListeners(AuditingEntityListener.class)
public class MessageReportEntity {

    @Id
    @GeneratedValue
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "message_id", nullable = false, updatable = false)
    private MessageEntity message;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "reporter_id", nullable = false, updatable = false)
    private UserEntity reporter;

    @Column(name = "body_at_report", nullable = false)
    private String bodyAtReport;

    @Column(length = 500)
    private String reason;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected MessageReportEntity() {
        // required by JPA
    }

    public MessageReportEntity(MessageEntity message, UserEntity reporter, String reason) {
        this.message = message;
        this.reporter = reporter;
        this.bodyAtReport = message.getBody();
        this.reason = reason;
    }

    public UUID getId() {
        return id;
    }

    public MessageEntity getMessage() {
        return message;
    }

    public UserEntity getReporter() {
        return reporter;
    }

    public String getBodyAtReport() {
        return bodyAtReport;
    }

    public String getReason() {
        return reason;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
