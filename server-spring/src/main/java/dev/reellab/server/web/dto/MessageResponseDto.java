package dev.reellab.server.web.dto;

import dev.reellab.server.persistence.entity.MessageEntity;
import dev.reellab.server.web.MediaUrlAssembler;
import java.time.Instant;
import java.util.UUID;

/**
 * One message.
 *
 * @param body plain text, exactly as stored. Nothing on the way out interprets it as markup.
 *     Empty when the message is only a shared clip.
 * @param clientId echoed back from the sender's own optimistic copy, so a client can match
 *     the message it queued to the one that came back over the socket instead of showing both
 * @param video the shared clip, or null for a plain message
 * @param videoRemoved true when a clip was shared and has since been deleted — the client
 *     says so in place of the card, rather than showing a message that looks empty
 */
public record MessageResponseDto(
        UUID id,
        UUID conversationId,
        UUID senderId,
        String body,
        String clientId,
        SharedVideoDto video,
        boolean videoRemoved,
        Instant createdAt) {

    public static MessageResponseDto from(MessageEntity message, String clientId,
                                          MediaUrlAssembler media) {
        return new MessageResponseDto(
                message.getId(),
                message.getConversation().getId(),
                message.getSender().getId(),
                message.getBody(),
                clientId,
                message.hasVideo() ? SharedVideoDto.from(message.getVideo(), media) : null,
                message.wasVideoRemoved(),
                message.getCreatedAt());
    }
}
