package dev.reellab.server.web.socket;

import static org.assertj.core.api.Assertions.assertThat;

import dev.reellab.server.TestcontainersConfiguration;
import dev.reellab.server.persistence.entity.ConversationEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.repository.ConversationRepository;
import dev.reellab.server.persistence.repository.UserRepository;
import dev.reellab.server.service.MessageService;
import dev.reellab.server.service.TokenService;
import java.lang.reflect.Type;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/**
 * The socket, driven by a real STOMP client over a real port.
 *
 * <p>MockMvc cannot test this — there is no socket in it. This starts the application on a
 * port and connects the way the app does, which is the only way to prove that an
 * unauthenticated CONNECT is refused and that a SUBSCRIBE to somebody else's conversation is
 * rejected by the SERVER rather than by a screen that simply never asks.
 *
 * <p>Raw WebSocket rather than SockJS: the endpoint is registered {@code withSockJS()}, which
 * also exposes {@code /ws/websocket} as a plain transport — and that is the one the React
 * Native client uses, because sockjs-client wants browser globals React Native does not have.
 * Testing the transport the app actually uses is the point.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class MessageSocketIntegrationTest {

    private static final long WAIT_SECONDS = 5;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("reellab.auth.secret", () -> "test-signing-key-that-is-long-enough-for-hs256");
    }

    @LocalServerPort int port;

    @Autowired UserRepository users;
    @Autowired ConversationRepository conversations;
    @Autowired TokenService tokens;
    @Autowired PasswordEncoder encoder;
    @Autowired JdbcTemplate jdbc;
    @Autowired MessageService messages;

    private WebSocketStompClient client;
    private UserEntity alice;
    private UserEntity bob;
    private UserEntity carol;
    private ConversationEntity thread;

    @BeforeEach
    void setUp() {
        jdbc.execute("truncate table message_reports, messages, conversation_reads, "
                + "conversations, user_blocks, password_resets, user_follows, video_likes, "
                + "comments, videos, users cascade");
        alice = save("alice");
        bob = save("bob");
        carol = save("carol");
        thread = conversations.save(new ConversationEntity(alice, bob));

        client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new MappingJackson2MessageConverter());
    }

    @AfterEach
    void tearDown() {
        client.stop();
    }

    private UserEntity save(String username) {
        return users.save(new UserEntity(username, username + "@example.com", username,
                encoder.encode("originalpassword")));
    }

    /**
     * On the CONNECT frame, not the handshake: SockJS's fallbacks have no single request to
     * carry a header, and a raw upgrade from a non-browser cannot set one.
     */
    private StompHeaders authHeaders(UserEntity as) {
        StompHeaders headers = new StompHeaders();
        if (as != null) {
            headers.add("Authorization", "Bearer " + tokens.issue(as));
        }
        return headers;
    }

    private StompSession connect(UserEntity as) throws Exception {
        return client.connectAsync("ws://localhost:" + port + "/ws/websocket",
                        new WebSocketHttpHeaders(), authHeaders(as),
                        new StompSessionHandlerAdapter() {
                        })
                .get(WAIT_SECONDS, TimeUnit.SECONDS);
    }

    /**
     * Collects frames from one subscription so a test can wait for one to arrive.
     *
     * <p>Takes the payload as raw bytes and asserts on the JSON text. Deserialising into a
     * DTO would test the test's converter as much as the server, and the frames are small
     * enough that reading them as text says more about what actually went over the wire.
     */
    private static class Inbox extends StompSessionHandlerAdapter implements StompFrameHandler {

        final LinkedBlockingQueue<String> frames = new LinkedBlockingQueue<>();

        @Override
        public Type getPayloadType(StompHeaders headers) {
            return byte[].class;
        }

        @Override
        public void handleFrame(StompHeaders headers, Object payload) {
            frames.add(payload instanceof byte[] bytes
                    ? new String(bytes, java.nio.charset.StandardCharsets.UTF_8)
                    : String.valueOf(payload));
        }

        String next() throws InterruptedException {
            return frames.poll(WAIT_SECONDS, TimeUnit.SECONDS);
        }

        /** For asserting nothing arrives: waits a shorter, fixed moment. */
        String nothingWithin(Duration window) throws InterruptedException {
            return frames.poll(window.toMillis(), TimeUnit.MILLISECONDS);
        }
    }

    /**
     * Subscribes and gives the server a moment to register it.
     *
     * <p>SUBSCRIBE is a frame, not a call: it returns as soon as it is written. Publishing
     * immediately afterwards races the broker's own bookkeeping, and losing that race looks
     * exactly like a broken subscription.
     */
    private static void subscribeAndSettle(StompSession session, String destination, Inbox inbox)
            throws InterruptedException {
        session.subscribe(destination, inbox);
        Thread.sleep(300);
    }

    // --- the criteria -------------------------------------------------------------

    /**
     * Two clients, one thread, live delivery — the stand-in for two physical devices. Two
     * independent sockets against a running server is the same arrangement; what a second
     * phone adds is a different network, not a different code path.
     */
    @Test
    void aMessageSentByOneParticipantReachesTheOtherLive() throws Exception {
        StompSession bobSession = connect(bob);
        Inbox bobInbox = new Inbox();
        subscribeAndSettle(bobSession, "/topic/conversations/" + thread.getId(), bobInbox);

        StompSession aliceSession = connect(alice);
        aliceSession.send("/app/conversations/" + thread.getId() + "/send",
                Map.of("body", "hello over the wire", "clientId", "c-1"));

        String frame = bobInbox.next();
        assertThat(frame).as("bob must receive it").isNotNull();
        assertThat(frame).contains("hello over the wire");
        // Echoed back so the sender can match its optimistic copy instead of drawing two.
        assertThat(frame).contains("c-1");
    }

    /**
     * An unauthenticated socket.
     *
     * <p>The CONNECT itself fails, which is the strongest form of this: there is no session to
     * subscribe with, so "cannot subscribe or send" holds without any further check.
     */
    @Test
    void aSocketWithNoTokenCannotEvenConnect() {
        assertThat(failureOf(() -> connect(null)))
                .as("connect must fail without a token")
                .isNotNull();
    }

    @Test
    void aSocketWithARubbishTokenCannotConnect() {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", "Bearer not-a-real-token");
        assertThat(failureOf(() -> client.connectAsync(
                        "ws://localhost:" + port + "/ws/websocket",
                        new WebSocketHttpHeaders(), headers, new StompSessionHandlerAdapter() {
                        })
                .get(WAIT_SECONDS, TimeUnit.SECONDS)))
                .isNotNull();
    }

    /**
     * The criterion that asks for a test which "sends the request directly, bypassing the UI".
     * This is it: carol holds a real session and a real conversation id, and subscribes to it
     * herself.
     */
    @Test
    void subscribingToSomeoneElsesConversationIsRejectedByTheServer() throws Exception {
        String destination = "/topic/conversations/" + thread.getId();

        StompSession carolSession = connect(carol);
        Inbox outsider = new Inbox();
        // The subscribe is refused in the interceptor, which STOMP turns into an ERROR frame
        // and a closed session. Whether the client surfaces that synchronously or not, the
        // observable consequence is the same and is what the assertions below check.
        try {
            subscribeAndSettle(carolSession, destination, outsider);
        } catch (RuntimeException expected) {
            // Either shape is a rejection.
        }

        // The positive control, and the reason this test means anything. Without a
        // participant who DOES receive the message, "carol got nothing" would also pass on a
        // server that delivers to nobody — which is every way this could be broken.
        StompSession bobSession = connect(bob);
        Inbox participant = new Inbox();
        subscribeAndSettle(bobSession, destination, participant);

        StompSession aliceSession = connect(alice);
        aliceSession.send("/app/conversations/" + thread.getId() + "/send",
                Map.of("body", "private between us", "clientId", "c-2"));

        assertThat(participant.next())
                .as("the other participant receives it")
                .contains("private between us");
        assertThat(outsider.nothingWithin(Duration.ofSeconds(2)))
                .as("carol receives nothing")
                .isNull();
    }

    /**
     * The refusal says why.
     *
     * <p>Spring's default wraps every inbound-channel failure as "Failed to send message to
     * ExecutorSubscribableChannel", which tells a client nothing it can show or act on.
     */
    @Test
    void aRefusedSubscribeComesBackWithItsReason() throws Exception {
        java.util.concurrent.LinkedBlockingQueue<String> errors =
                new java.util.concurrent.LinkedBlockingQueue<>();

        // A STOMP ERROR frame reaches the SESSION handler, not a subscription's — there is
        // no subscription by then, which is the whole point.
        StompSession carolSession = client.connectAsync(
                "ws://localhost:" + port + "/ws/websocket",
                new WebSocketHttpHeaders(), authHeaders(carol),
                new StompSessionHandlerAdapter() {
                    @Override
                    public void handleFrame(StompHeaders headers, Object payload) {
                        // The reason travels in the ERROR frame's `message` header and,
                        // for good measure, in its body.
                        errors.add(headers.getFirst("message") + " " + asText(payload));
                    }

                    @Override
                    public void handleException(StompSession session, StompCommand command,
                                                StompHeaders headers, byte[] payload,
                                                Throwable exception) {
                        errors.add(headers.getFirst("message") + " " + asText(payload));
                    }
                }).get(WAIT_SECONDS, TimeUnit.SECONDS);

        try {
            carolSession.subscribe("/topic/conversations/" + thread.getId(), new Inbox());
        } catch (RuntimeException expected) {
            // Either shape is a rejection.
        }

        assertThat(errors.poll(WAIT_SECONDS, TimeUnit.SECONDS))
                .as("the client must be told why")
                .contains("not yours");
    }

    @Test
    void aParticipantCanSubscribeToTheirOwnConversation() throws Exception {
        StompSession session = connect(alice);
        Inbox inbox = new Inbox();
        subscribeAndSettle(session, "/topic/conversations/" + thread.getId(), inbox);

        StompSession bobSession = connect(bob);
        bobSession.send("/app/conversations/" + thread.getId() + "/send",
                Map.of("body", "yours to read", "clientId", "c-3"));

        assertThat(inbox.next()).contains("yours to read");
    }

    /**
     * A refused send comes back to the sender rather than vanishing.
     *
     * <p>A frame has no status code, so without this a message rejected for a block or a rate
     * limit would look, on the sending device, exactly like one that was delivered.
     */
    @Test
    void aRefusedSocketSendIsReportedOnTheSendersOwnQueue() throws Exception {
        StompSession carolSession = connect(carol);
        Inbox errors = new Inbox();
        subscribeAndSettle(carolSession, "/user/queue/errors", errors);

        carolSession.send("/app/conversations/" + thread.getId() + "/send",
                Map.of("body", "let me in", "clientId", "c-9"));

        String frame = errors.next();
        assertThat(frame).as("the sender must be told").isNotNull();
        assertThat(frame).contains("c-9");

        assertThat(jdbc.queryForObject("select count(*) from messages", Long.class))
                .as("and nothing was written").isZero();
    }

    private static String asText(Object payload) {
        return payload instanceof byte[] bytes
                ? new String(bytes, java.nio.charset.StandardCharsets.UTF_8)
                : String.valueOf(payload);
    }

    private static Throwable failureOf(ThrowingCall call) {
        try {
            call.run();
            return null;
        } catch (Exception e) {
            return e;
        }
    }

    private interface ThrowingCall {
        void run() throws Exception;
    }
}
