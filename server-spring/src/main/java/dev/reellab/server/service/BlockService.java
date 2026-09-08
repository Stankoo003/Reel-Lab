package dev.reellab.server.service;

import dev.reellab.server.persistence.entity.UserBlockEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.repository.UserBlockRepository;
import dev.reellab.server.service.exception.ValidationException;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Blocking, and the one question every message send asks before it is accepted. */
@Service
public class BlockService {

    public static final String CANNOT_BLOCK_SELF = "You cannot block yourself.";

    /**
     * Deliberately says nothing about WHO blocked whom.
     *
     * <p>Telling the sender "they blocked you" is telling them something the other person
     * chose not to say. Telling them nothing at all would be a message that silently
     * vanishes. This sits between: the send failed, the conversation is closed, and no more
     * than that.
     */
    public static final String BLOCKED = "You can no longer message this person.";

    private final UserBlockRepository blocks;
    private final UserService users;

    public BlockService(UserBlockRepository blocks, UserService users) {
        this.blocks = blocks;
        this.users = users;
    }

    @Transactional
    public void block(UUID blockerId, UUID blockedId) {
        if (blockerId.equals(blockedId)) {
            throw new ValidationException(CANNOT_BLOCK_SELF);
        }
        UserEntity blocker = users.require(blockerId);
        UserEntity blocked = users.require(blockedId);
        // Idempotent, like a like: blocking someone already blocked is not an error, and a
        // client that retries must not get one.
        if (!blocks.existsByBlockerIdAndBlockedId(blockerId, blockedId)) {
            blocks.save(new UserBlockEntity(blocker, blocked));
        }
    }

    @Transactional
    public void unblock(UUID blockerId, UUID blockedId) {
        blocks.deleteByBlockerIdAndBlockedId(blockerId, blockedId);
    }

    @Transactional(readOnly = true)
    public List<UserBlockEntity> blockedBy(UUID blockerId) {
        return blocks.findAllByBlockerId(blockerId);
    }

    /** Either direction — see UserBlockRepository.blockExistsBetween. */
    @Transactional(readOnly = true)
    public boolean isBlockedBetween(UUID one, UUID other) {
        return blocks.blockExistsBetween(one, other);
    }

    /** Throws if these two may not exchange messages. */
    @Transactional(readOnly = true)
    public void requireNotBlocked(UUID one, UUID other) {
        if (blocks.blockExistsBetween(one, other)) {
            throw new BlockedException(BLOCKED);
        }
    }

    /** Its own type so the web layer answers 403 rather than 422. */
    public static class BlockedException extends RuntimeException {
        public BlockedException(String message) {
            super(message);
        }
    }
}
