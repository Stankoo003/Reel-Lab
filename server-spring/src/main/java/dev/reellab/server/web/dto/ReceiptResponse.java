package dev.reellab.server.web.dto;

import dev.reellab.server.persistence.entity.ConversationReadEntity;
import java.time.Instant;
import java.util.UUID;

/**
 * How far one participant has received and read a thread.
 *
 * <p>Two watermarks, not a status per message. A sender's message is "seen" when it is older
 * than {@code readAt}, "delivered" when older than {@code deliveredAt}, and "sent" otherwise —
 * a comparison the client makes, so a receipt is one small frame however long the thread is.
 *
 * <p>Also published on the conversation's topic when either watermark moves. It has no
 * {@code body}, which is how a client tells it apart from a message on the same topic.
 *
 * @param readAt null while the participant has never opened the thread
 */
public record ReceiptResponse(
        UUID conversationId,
        UUID userId,
        Instant deliveredAt,
        Instant readAt) {

    public static ReceiptResponse from(ConversationReadEntity row) {
        return new ReceiptResponse(row.getConversationId(), row.getUserId(),
                row.getLastDeliveredAt(), row.getLastReadAt());
    }
}
