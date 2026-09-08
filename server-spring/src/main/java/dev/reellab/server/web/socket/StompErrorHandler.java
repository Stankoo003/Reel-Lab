package dev.reellab.server.web.socket;

import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.messaging.StompSubProtocolErrorHandler;

/**
 * Turns a refusal into an ERROR frame that says what happened.
 *
 * <p>Without this, Spring's default wraps every failure from the inbound channel as
 * "Failed to send message to ExecutorSubscribableChannel[clientInboundChannel]" — true, and
 * useless to the client and to anyone debugging it. The reason a subscribe was refused is
 * something the app should be able to show, and something a test can assert on.
 *
 * <p>Only OUR exception's message is passed through. Anything else keeps the generic text:
 * an unexpected server-side failure should not be describing itself to a client.
 */
public class StompErrorHandler extends StompSubProtocolErrorHandler {

    @Override
    public Message<byte[]> handleClientMessageProcessingError(Message<byte[]> clientMessage,
                                                              Throwable ex) {
        Throwable cause = ex;
        while (cause != null && !(cause instanceof StompAuthInterceptor.UnauthorizedSocketException)) {
            cause = cause.getCause();
        }
        if (cause == null) {
            return super.handleClientMessageProcessingError(clientMessage, ex);
        }

        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.ERROR);
        accessor.setMessage(cause.getMessage());
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(
                cause.getMessage().getBytes(java.nio.charset.StandardCharsets.UTF_8),
                accessor.getMessageHeaders());
    }
}
