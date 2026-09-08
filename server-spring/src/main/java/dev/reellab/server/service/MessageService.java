package dev.reellab.server.service;

import dev.reellab.server.config.MessagingProperties;
import dev.reellab.server.persistence.entity.ConversationEntity;
import dev.reellab.server.persistence.entity.ConversationReadEntity;
import dev.reellab.server.persistence.entity.MessageEntity;
import dev.reellab.server.persistence.entity.MessageReportEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.persistence.repository.ConversationReadRepository;
import dev.reellab.server.persistence.repository.MessageReportRepository;
import dev.reellab.server.persistence.repository.MessageRepository;
import dev.reellab.server.service.exception.ForbiddenException;
import dev.reellab.server.service.exception.NotFoundException;
import dev.reellab.server.service.exception.ValidationException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Sending, reading and paging messages. */
@Service
public class MessageService {

    public static final String EMPTY_BODY = "A message needs some text.";
    public static final String TOO_LONG = "A message can be at most 4000 characters.";
    public static final String RATE_LIMITED = "You are sending messages too quickly.";
    public static final String VIDEO_NOT_SHAREABLE = "That video cannot be shared.";
    public static final int MAX_BODY = 4000;

    private final MessageRepository messages;
    private final ConversationReadRepository reads;
    private final MessageReportRepository reports;
    private final ConversationService conversations;
    private final BlockService blocks;
    private final UserService users;
    private final VideoService videos;
    private final RequestRateLimiter limiter;
    private final MessagingProperties config;

    public MessageService(MessageRepository messages, ConversationReadRepository reads,
                          MessageReportRepository reports, ConversationService conversations,
                          BlockService blocks, UserService users, VideoService videos,
                          RequestRateLimiter limiter, MessagingProperties config) {
        this.messages = messages;
        this.reads = reads;
        this.reports = reports;
        this.conversations = conversations;
        this.blocks = blocks;
        this.users = users;
        this.videos = videos;
        this.limiter = limiter;
        this.config = config;
    }

    /**
     * Send one message.
     *
     * <p>The order of the checks is the point. Participation first, because a caller who is
     * not in the thread should learn nothing else about it — not whether it exists, not
     * whether the other person blocked them, not whether they are over their rate limit.
     * Only then the block, then the shape of the body, then how fast they are going.
     */
    @Transactional
    public MessageEntity send(UUID conversationId, UUID senderId, String rawBody) {
        return send(conversationId, senderId, rawBody, null);
    }

    /**
     * Send one message, with a shared clip or without.
     *
     * @param videoId a clip to share, or null. Only a published clip can be shared: a draft
     *     is visible to its owner alone, and a message would be a way around that.
     */
    @Transactional
    public MessageEntity send(UUID conversationId, UUID senderId, String rawBody, UUID videoId) {
        ConversationEntity conversation =
                conversations.requireParticipant(conversationId, senderId);
        blocks.requireNotBlocked(senderId, conversation.other(senderId).getId());

        // Looked up before the body is judged: a shared clip needs no words, so whether the
        // body may be empty depends on there being a clip.
        VideoEntity video = null;
        if (videoId != null) {
            video = videos.findShareable(videoId)
                    .orElseThrow(() -> new ValidationException(VIDEO_NOT_SHAREABLE));
        }

        String body = rawBody == null ? "" : rawBody.strip();
        if (body.isEmpty() && video == null) {
            throw new ValidationException(EMPTY_BODY);
        }
        if (body.length() > MAX_BODY) {
            throw new ValidationException(TOO_LONG);
        }
        // Per user, not per conversation: the abuse this stops is one account firing at
        // anybody, and a per-thread limit would let it fire at ten people at ten times the
        // rate. Counted in memory rather than by querying the table, so a burst does not
        // also become a burst of database work.
        if (!limiter.tryAcquire("dm:send:" + senderId, config.sendLimit(), config.sendWindow())) {
            throw new PasswordResetService.TooManyRequestsException(RATE_LIMITED);
        }

        UserEntity sender = users.require(senderId);
        MessageEntity saved = messages.save(new MessageEntity(conversation, sender, body, video));
        // The list orders on this, so it has to move with the message rather than being
        // recomputed later from a query over the thread.
        conversation.touch(saved.getCreatedAt() == null ? Instant.now() : saved.getCreatedAt());
        // The sender has by definition read what they just sent.
        markRead(conversationId, senderId, conversation.getLastMessageAt());
        return saved;
    }

    /**
     * One page of a thread, newest first.
     *
     * @param before the cursor: the oldest message the client already has, or null for the
     *     newest page
     */
    @Transactional(readOnly = true)
    public List<MessageEntity> page(UUID conversationId, UUID viewerId, Instant beforeAt,
                                    UUID beforeId, Integer limit) {
        conversations.requireParticipant(conversationId, viewerId);
        int size = Math.clamp(limit == null ? config.pageSize() : limit, 1, 100);
        PageRequest page = PageRequest.of(0, size);
        return beforeAt == null || beforeId == null
                ? messages.newestPage(conversationId, page)
                : messages.pageBefore(conversationId, beforeAt, beforeId, page);
    }

    /**
     * What arrived after a moment.
     *
     * <p>The reconnect path. A socket that was down did not queue anything for us — the
     * server published to a topic nobody was listening on — so the client asks for the gap
     * explicitly rather than assuming the live stream was complete.
     */
    @Transactional(readOnly = true)
    public List<MessageEntity> since(UUID conversationId, UUID viewerId, Instant after) {
        conversations.requireParticipant(conversationId, viewerId);
        return messages.since(conversationId, after, PageRequest.of(0, 200));
    }

    @Transactional
    public ConversationReadEntity markRead(UUID conversationId, UUID userId, Instant at) {
        Instant when = at == null ? Instant.now() : at;
        ConversationReadEntity row = reads.find(conversationId, userId).orElse(null);
        if (row == null) {
            return reads.save(new ConversationReadEntity(conversationId, userId, when));
        }
        row.markRead(when);
        return row;
    }

    /** Opening a thread reads it to the end — the only place unread is cleared. */
    @Transactional
    public ConversationReadEntity markReadNow(UUID conversationId, UUID userId) {
        conversations.requireParticipant(conversationId, userId);
        return markRead(conversationId, userId, Instant.now());
    }

    /**
     * The thread has reached this participant's device — the second tick.
     *
     * <p>Distinct from reading it: a message can sit in an inbox, received and unopened, and
     * the sender is told exactly that. {@code moved} is false when the device had already
     * said so, so a client refreshing its inbox does not make the server repeat itself.
     */
    @Transactional
    public Delivery markDelivered(UUID conversationId, UUID userId) {
        conversations.requireParticipant(conversationId, userId);
        return deliver(conversationId, userId, Instant.now());
    }

    /**
     * Every thread this user is in, at once — what an inbox calls once it has loaded.
     *
     * <p>Only the threads where something arrived since the last receipt are touched, and
     * only those come back: each one becomes a frame to the other participant, and a receipt
     * for a thread nobody has written in is a frame that says nothing.
     */
    @Transactional
    public List<ConversationReadEntity> markAllDelivered(UUID userId) {
        Instant now = Instant.now();
        List<ConversationReadEntity> moved = new ArrayList<>();
        for (ConversationEntity conversation : conversations.listFor(userId)) {
            Instant lastMessageAt = conversation.getLastMessageAt();
            if (lastMessageAt == null) {
                continue;
            }
            ConversationReadEntity row = reads.find(conversation.getId(), userId).orElse(null);
            if (row != null && !row.getLastDeliveredAt().isBefore(lastMessageAt)) {
                continue;
            }
            moved.add(deliver(conversation.getId(), userId, now).row());
        }
        return moved;
    }

    private Delivery deliver(UUID conversationId, UUID userId, Instant at) {
        ConversationReadEntity row = reads.find(conversationId, userId).orElse(null);
        if (row == null) {
            return new Delivery(
                    reads.save(ConversationReadEntity.delivered(conversationId, userId, at)), true);
        }
        return new Delivery(row, row.markDelivered(at));
    }

    /** How far the OTHER participant has received and read a thread — for the ticks. */
    @Transactional(readOnly = true)
    public Optional<ConversationReadEntity> otherReceipt(UUID conversationId, UUID viewerId) {
        ConversationEntity conversation = conversations.requireParticipant(conversationId, viewerId);
        return reads.find(conversationId, conversation.other(viewerId).getId());
    }

    @Transactional(readOnly = true)
    public long unreadCount(UUID conversationId, UUID userId) {
        Instant since = reads.find(conversationId, userId)
                .map(ConversationReadEntity::getLastReadAt)
                .orElse(null);
        return since == null
                ? messages.countUnreadAll(conversationId, userId)
                : messages.countUnreadSince(conversationId, userId, since);
    }

    /** Last message and unread count for a whole list — a handful of queries, not per row. */
    @Transactional(readOnly = true)
    public ListSummary summarise(Collection<UUID> conversationIds, UUID viewerId) {
        if (conversationIds.isEmpty()) {
            return new ListSummary(Map.of(), Map.of(), Map.of());
        }
        Map<UUID, MessageEntity> last = new HashMap<>();
        for (MessageEntity message : messages.lastMessagesOf(conversationIds)) {
            last.put(message.getConversation().getId(), message);
        }
        Map<UUID, Instant> watermarks = new HashMap<>();
        for (ConversationReadEntity read : reads.findAllForUser(viewerId, conversationIds)) {
            watermarks.put(read.getConversationId(), read.getLastReadAt());
        }
        Map<UUID, Long> unread = new HashMap<>();
        for (UUID id : conversationIds) {
            Instant since = watermarks.get(id);
            unread.put(id, since == null
                    ? messages.countUnreadAll(id, viewerId)
                    : messages.countUnreadSince(id, viewerId, since));
        }
        // The other side's watermarks, for the tick under your own last message. One query
        // for the list; the viewer's own rows are simply skipped.
        Map<UUID, ConversationReadEntity> otherReceipts = new HashMap<>();
        for (ConversationReadEntity read : reads.findAllForConversations(conversationIds)) {
            if (!read.getUserId().equals(viewerId)) {
                otherReceipts.put(read.getConversationId(), read);
            }
        }
        return new ListSummary(last, unread, otherReceipts);
    }

    @Transactional
    public MessageReportEntity report(UUID messageId, UUID reporterId, String reason) {
        MessageEntity message = messages.findById(messageId)
                .orElseThrow(() -> new NotFoundException("Message", messageId));
        // You may only report a message you could see. Otherwise this endpoint would confirm
        // whether any given message id exists, to anybody.
        if (!message.getConversation().includes(reporterId)) {
            throw new ForbiddenException(ConversationService.NOT_A_PARTICIPANT);
        }
        // Reporting twice is the same complaint twice. Returning the existing row keeps the
        // client's "reported" state true without recording a second one.
        return reports.findByMessageIdAndReporterId(messageId, reporterId)
                .orElseGet(() -> reports.save(
                        new MessageReportEntity(message, users.require(reporterId), reason)));
    }

    /** A delivery receipt, and whether this call is what moved it. */
    public record Delivery(ConversationReadEntity row, boolean moved) {
    }

    /**
     * Last message, unread count and the other side's receipt, keyed by conversation. Absent
     * means none / zero / never received.
     */
    public record ListSummary(Map<UUID, MessageEntity> lastMessages, Map<UUID, Long> unread,
                              Map<UUID, ConversationReadEntity> otherReceipts) {

        public MessageEntity lastOf(UUID conversationId) {
            return lastMessages.get(conversationId);
        }

        public long unreadOf(UUID conversationId) {
            return unread.getOrDefault(conversationId, 0L);
        }

        public ConversationReadEntity otherReceiptOf(UUID conversationId) {
            return otherReceipts.get(conversationId);
        }
    }
}
