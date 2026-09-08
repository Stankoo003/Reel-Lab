package dev.reellab.server.web.dto;

import java.util.List;

/**
 * One page of a thread, newest first.
 *
 * @param nextCursor pass back as {@code cursor} to get the page of OLDER messages; null when
 *     the thread has no more history
 * @param otherReceipt how far the OTHER participant has received and read the thread — what
 *     the ticks under the viewer's own messages are drawn from. Null until they have
 *     received anything.
 */
public record MessagePageResponse(List<MessageResponseDto> items, String nextCursor,
                                  boolean hasMore, ReceiptResponse otherReceipt) {
}
