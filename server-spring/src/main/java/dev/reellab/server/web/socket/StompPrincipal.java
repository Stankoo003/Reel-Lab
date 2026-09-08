package dev.reellab.server.web.socket;

import java.security.Principal;
import java.util.UUID;

/**
 * Who a socket belongs to, established once at CONNECT and carried on every later frame.
 *
 * <p>The whole security model of the socket rests on this being set from the token at CONNECT
 * and never from anything the client sends afterwards. A STOMP frame's headers are as
 * client-controlled as a request body.
 */
public record StompPrincipal(UUID userId) implements Principal {

    @Override
    public String getName() {
        return userId.toString();
    }
}
