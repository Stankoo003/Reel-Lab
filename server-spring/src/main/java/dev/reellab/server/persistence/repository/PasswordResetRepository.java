package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.PasswordResetEntity;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PasswordResetRepository extends JpaRepository<PasswordResetEntity, UUID> {

    /**
     * The row for a token, found BY ITS HASH — the only lookup this table supports, because
     * the plaintext is never stored to look up by.
     */
    Optional<PasswordResetEntity> findByTokenHash(String tokenHash);

    /**
     * Retire every outstanding token for one user.
     *
     * <p>Called when a new one is issued and again when a reset completes. Marking them
     * consumed rather than deleting them keeps "this link was already used or replaced"
     * answerable — a deleted row is indistinguishable from a token that never existed, and
     * the two deserve the same message but not the same certainty in the log.
     */
    @Modifying
    @Query("""
            update PasswordResetEntity r
            set r.consumedAt = :now
            where r.user.id = :userId and r.consumedAt is null
            """)
    int consumeOutstanding(@Param("userId") UUID userId, @Param("now") Instant now);

    /** How many resets this address asked for since a moment — the per-email rate limit. */
    long countByUserIdAndCreatedAtAfter(UUID userId, Instant since);
}
