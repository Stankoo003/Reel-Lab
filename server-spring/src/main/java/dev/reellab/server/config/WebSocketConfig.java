package dev.reellab.server.config;

import dev.reellab.server.service.ConversationService;
import dev.reellab.server.web.socket.StompAuthInterceptor;
import dev.reellab.server.web.socket.StompErrorHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * STOMP over SockJS.
 *
 * <p>The broker is the simple in-memory one. That is a deliberate limit rather than an
 * oversight: it delivers only to sessions held by THIS instance, so a second instance behind
 * a load balancer would not see the first one's subscribers. The upgrade is a relay
 * (RabbitMQ or ActiveMQ) and it changes this one method. Until there is a second instance it
 * would be infrastructure with nothing to do.
 *
 * <p>SockJS is enabled on the endpoint, which also leaves the raw {@code /ws/websocket}
 * transport available — that is what the React Native client uses, because sockjs-client
 * expects browser globals that React Native does not have.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final JwtDecoder decoder;
    private final ConversationService conversations;

    public WebSocketConfig(JwtDecoder decoder, ConversationService conversations) {
        this.decoder = decoder;
        this.conversations = conversations;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.setErrorHandler(new StompErrorHandler());
        registry.addEndpoint("/ws")
                // The socket is authenticated by its CONNECT frame, not by an origin, and
                // the app is not a browser page — there is no cookie for a hostile site to
                // ride on, which is what an origin check would be protecting.
                .setAllowedOriginPatterns("*")
                .withSockJS();
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // Every inbound frame passes through this — CONNECT, SUBSCRIBE and SEND alike.
        registration.interceptors(new StompAuthInterceptor(decoder, conversations));
    }
}
