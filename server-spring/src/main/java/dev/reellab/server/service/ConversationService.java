package dev.reellab.server.service;

import dev.reellab.server.persistence.entity.ConversationEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.repository.ConversationRepository;
import dev.reellab.server.service.exception.ForbiddenException;
import dev.reellab.server.service.exception.NotFoundException;
import dev.reellab.server.service.exception.ValidationException;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Threads, and who is allowed to see one.
 *
 * <p>{@link #requireParticipant} is the single definition of that permission. Every path into
 * a conversation — REST read, REST send, socket subscribe, socket send — goes through it, so
 * there is no route where a conversation id supplied by a client is treated as permission to
 * see the conversation it names.
 */
@Service
public class ConversationService {

    public static final String NOT_A_PARTICIPANT = "That conversation is not yours.";

    public static final String NO_SELF_CONVERSATION = "You cannot message yourself.";

    private final ConversationRepository conversations;
    private final UserService users;
    private final BlockService blocks;

    public ConversationService(ConversationRepository conversations, UserService users,
                               BlockService blocks) {
        this.conversations = conversations;
        this.users = users;
        this.blocks = blocks;
    }

    /**
     * The conversation between two people, creating it if this is the first time.
     *
     * <p>Blocked pairs cannot get one at all: "a blocked user cannot START or continue a
     * conversation", and refusing here is what makes the first half of that true.
     */
    @Transactional
    public ConversationEntity openWith(UUID viewerId, UUID otherId) {
        if (viewerId.equals(otherId)) {
            throw new ValidationException(NO_SELF_CONVERSATION);
        }
        blocks.requireNotBlocked(viewerId, otherId);

        UserEntity viewer = users.require(viewerId);
        UserEntity other = users.require(otherId);
        // Postgres's ordering, not Java's — see ConversationEntity.compare.
        UUID smaller = ConversationEntity.compare(viewerId, otherId) < 0 ? viewerId : otherId;
        UUID larger = smaller.equals(viewerId) ? otherId : viewerId;

        return conversations.findByUserAIdAndUserBId(smaller, larger)
                .orElseGet(() -> conversations.save(new ConversationEntity(viewer, other)));
    }

    @Transactional(readOnly = true)
    public List<ConversationEntity> listFor(UUID viewerId) {
        return conversations.findAllForUser(viewerId);
    }

    /**
     * The conversation, or a refusal.
     *
     * <p>404 for an id that does not exist, 403 for one that does and is not yours. Both are
     * failures the caller cannot act on, and collapsing them into one would hide a bug in the
     * app behind a security answer.
     */
    @Transactional(readOnly = true)
    public ConversationEntity requireParticipant(UUID conversationId, UUID viewerId) {
        ConversationEntity conversation = conversations.findById(conversationId)
                .orElseThrow(() -> new NotFoundException("Conversation", conversationId));
        if (!conversation.includes(viewerId)) {
            throw new ForbiddenException(NOT_A_PARTICIPANT);
        }
        return conversation;
    }

    /** Same check, as a boolean — for the socket interceptor, which answers with a frame. */
    @Transactional(readOnly = true)
    public boolean isParticipant(UUID conversationId, UUID viewerId) {
        return conversations.findById(conversationId)
                .map(conversation -> conversation.includes(viewerId))
                .orElse(false);
    }
}
