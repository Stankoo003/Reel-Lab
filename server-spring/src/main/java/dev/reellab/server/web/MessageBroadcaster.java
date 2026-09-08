package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.MessageEntity;
import dev.reellab.server.web.dto.MessageResponseDto;
import dev.reellab.server.web.dto.ReceiptResponse;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Puts a saved message on the wire.
 *
 * <p>Both send paths call this after the message is COMMITTED, never before. A message
 * broadcast first and persisted second is one that can appear on a screen and then not exist
 * — and in a chat, a message you saw and cannot find again is worse than one that was slow.
 */
@Component
public class MessageBroadcaster {

    private final SimpMessagingTemplate template;
    private final MediaUrlAssembler media;

    public MessageBroadcaster(SimpMessagingTemplate template, MediaUrlAssembler media) {
        this.template = template;
        this.media = media;
    }

    /** The wire shape of a message, with a shared clip's URLs composed the way the feed does. */
    public MessageResponseDto toDto(MessageEntity message, String clientId) {
        return MessageResponseDto.from(message, clientId, media);
    }

    public void publish(MessageEntity message, String clientId) {
        String destination = "/topic/conversations/" + message.getConversation().getId();
        // Only participants can ever be subscribed here — the interceptor checks that on
        // SUBSCRIBE — so publishing to the topic reaches exactly the two people involved.
        template.convertAndSend(destination, toDto(message, clientId));
    }

    /**
     * A watermark moved: the other side has received, or read, up to here.
     *
     * <p>Same topic as the messages, so a client watching a thread needs one subscription,
     * not two. A receipt has no {@code body}; that is how the client tells them apart.
     */
    public void publishReceipt(ReceiptResponse receipt) {
        template.convertAndSend("/topic/conversations/" + receipt.conversationId(), receipt);
    }
}
