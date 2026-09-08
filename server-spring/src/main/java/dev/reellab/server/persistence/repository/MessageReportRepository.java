package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.MessageReportEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MessageReportRepository extends JpaRepository<MessageReportEntity, UUID> {

    boolean existsByMessageIdAndReporterId(UUID messageId, UUID reporterId);

    Optional<MessageReportEntity> findByMessageIdAndReporterId(UUID messageId, UUID reporterId);
}
