package dev.reellab.server.web.socket;

import dev.reellab.server.persistence.entity.MessageEntity;
import dev.reellab.server.service.MessageService;
import dev.reellab.server.web.MessageBroadcaster;
import dev.reellab.server.web.dto.SendMessageRequest;
import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

/**
 * Sending over the socket.
 *
 * <p>Exists so a client with a live connection does not have to open an HTTP request for
 * every line typed. It enforces nothing of its own: the identity comes from the session
 * principal established at CONNECT, and every rule — participation, blocking, length, rate —
 * is the same {@link MessageService#send} call the REST path makes. A second copy of those
 * checks here is how the two paths would eventually disagree.
 *
 * <p>A frame has no status code, so a refusal comes back on the sender's own queue rather
 * than as an error the client would never see.
 */
@Controller
public class MessageSocketController {

    private static final Logger log = LoggerFactory.getLogger(MessageSocketController.class);

    private final MessageService messages;
    private final MessageBroadcaster broadcaster;
    private final SimpMessagingTemplate template;

    public MessageSocketController(MessageService messages, MessageBroadcaster broadcaster,
                                   SimpMessagingTemplate template) {
        this.messages = messages;
        this.broadcaster = broadcaster;
        this.template = template;
    }

    @MessageMapping("/conversations/{id}/send")
    public void send(@DestinationVariable UUID id, SendMessageRequest request,
                     Principal principal) {
        // Never null: the interceptor refuses a SEND without a principal before it reaches
        // any mapping. Checked anyway, because "cannot happen" is what a security hole is
        // made of.
        if (!(principal instanceof StompPrincipal sender)) {
            return;
        }
        try {
            MessageEntity saved =
                    messages.send(id, sender.userId(), request.body(), request.videoId());
            broadcaster.publish(saved, request.clientId());
        } catch (RuntimeException e) {
            log.debug("Refused a socket send", e);
            // To the sender only. /user/** resolves against the session's own principal, so
            // this cannot reach anyone else.
            template.convertAndSendToUser(sender.getName(), "/queue/errors", Map.of(
                    "conversationId", id.toString(),
                    "clientId", request.clientId() == null ? "" : request.clientId(),
                    "message", e.getMessage() == null ? "That message was not sent." : e.getMessage()));
        }
    }
}
