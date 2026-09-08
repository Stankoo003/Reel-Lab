package dev.reellab.server.web.socket;

import dev.reellab.server.service.ConversationService;
import java.util.List;
import java.util.UUID;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

/**
 * The socket's security, and all of it.
 *
 * <p>Two rules, applied to every inbound frame before it reaches a broker or a controller:
 *
 * <ol>
 *   <li><b>CONNECT must carry a valid token.</b> An unauthenticated socket gets no principal,
 *       and every rule below refuses a frame without one — so it can open a TCP connection
 *       and do nothing else with it.
 *   <li><b>SUBSCRIBE to a conversation topic must be by a participant.</b> The destination
 *       carries a conversation id that the CLIENT chose, which makes it a request rather than
 *       a permission. It is checked against the database here, on the server, on every
 *       subscribe.
 * </ol>
 *
 * <p>Rejecting from an interceptor throws, which STOMP turns into an ERROR frame and closes
 * the session — the client learns it failed, and no subscription is registered.
 */
public class StompAuthInterceptor implements ChannelInterceptor {

    /** Topics under this are per-conversation and therefore need the participation check. */
    public static final String CONVERSATION_TOPIC = "/topic/conversations/";

    /** A user's own queue — their id is in the destination, and only they may listen to it. */
    public static final String USER_QUEUE = "/user/queue/";

    private final JwtDecoder decoder;
    private final ConversationService conversations;

    public StompAuthInterceptor(JwtDecoder decoder, ConversationService conversations) {
        this.decoder = decoder;
        this.conversations = conversations;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }

        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            accessor.setUser(authenticate(accessor));
            return message;
        }

        // Everything that is not a CONNECT needs the principal that CONNECT established.
        // A socket that never authenticated has none, so this is where "cannot subscribe or
        // send" is actually enforced.
        StompPrincipal principal = principalOf(accessor);
        if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            requireMaySubscribe(principal, accessor.getDestination());
        }
        if (StompCommand.SEND.equals(accessor.getCommand()) && principal == null) {
            throw new UnauthorizedSocketException("Sign in before sending.");
        }
        return message;
    }

    private StompPrincipal authenticate(StompHeaderAccessor accessor) {
        // The CONNECT frame's own header, not an HTTP one: the handshake may be a plain
        // WebSocket upgrade with no way to attach an Authorization header, and SockJS
        // fallbacks have no single request to attach it to either.
        List<String> values = accessor.getNativeHeader("Authorization");
        String header = values == null || values.isEmpty() ? null : values.get(0);
        if (header == null || !header.startsWith("Bearer ")) {
            throw new UnauthorizedSocketException("This socket needs a token.");
        }
        try {
            Jwt jwt = decoder.decode(header.substring("Bearer ".length()).trim());
            // The same decoder the REST side uses, so a token invalidated by a password
            // change is refused here too — see PasswordChangeTokenValidator.
            return new StompPrincipal(UUID.fromString(jwt.getSubject()));
        } catch (JwtException | IllegalArgumentException e) {
            throw new UnauthorizedSocketException("That token is not valid.");
        }
    }

    private void requireMaySubscribe(StompPrincipal principal, String destination) {
        if (principal == null) {
            throw new UnauthorizedSocketException("Sign in before subscribing.");
        }
        if (destination == null) {
            throw new UnauthorizedSocketException("A subscription needs a destination.");
        }
        if (destination.startsWith(CONVERSATION_TOPIC)) {
            String tail = destination.substring(CONVERSATION_TOPIC.length());
            UUID conversationId;
            try {
                conversationId = UUID.fromString(tail);
            } catch (IllegalArgumentException e) {
                throw new UnauthorizedSocketException("That is not a conversation.");
            }
            if (!conversations.isParticipant(conversationId, principal.userId())) {
                // Deliberately the same answer for "not yours" and "does not exist". Over a
                // socket there is no reason to distinguish them, and doing so would let
                // anyone probe which conversation ids are real.
                throw new UnauthorizedSocketException(ConversationService.NOT_A_PARTICIPANT);
            }
            return;
        }
        if (destination.startsWith(USER_QUEUE)) {
            // Spring resolves /user/** against the session's own principal, so a client
            // cannot listen to somebody else's queue by naming them.
            return;
        }
        throw new UnauthorizedSocketException("Nothing to subscribe to there.");
    }

    private static StompPrincipal principalOf(StompHeaderAccessor accessor) {
        return accessor.getUser() instanceof StompPrincipal principal ? principal : null;
    }

    /** Refused at the socket. STOMP turns this into an ERROR frame and drops the session. */
    public static class UnauthorizedSocketException extends RuntimeException {
        public UnauthorizedSocketException(String message) {
            super(message);
        }
    }
}
