package dev.reellab.server.web.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One row of the conversation list.
 *
 * @param other who you are talking to — a 1:1 thread has exactly one, so it is a field
 *     rather than a list
 * @param lastMessage null for a thread nobody has written in yet
 * @param unreadCount messages from the other person newer than your read watermark
 * @param otherReceipt how far the other person has received and read the thread, so the
 *     list can tick your own last message. Null until they have received anything.
 */
public record ConversationResponse(
        UUID id,
        UserSummaryResponse other,
        MessageResponseDto lastMessage,
        long unreadCount,
        ReceiptResponse otherReceipt,
        boolean blocked,
        Instant lastMessageAt,
        Instant createdAt) {
}
