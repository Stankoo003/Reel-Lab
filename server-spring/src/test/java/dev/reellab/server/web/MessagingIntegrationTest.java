package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.service.BlockService;
import dev.reellab.server.service.ConversationService;
import dev.reellab.server.service.MessageService;
import dev.reellab.server.service.RequestRateLimiter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;

/** Direct messages over HTTP: sending, paging, authorization, blocking and rate limiting. */
@TestPropertySource(properties = {
    // Small enough to hit deliberately, large enough that a normal test does not.
    "reellab.messaging.send-limit=5",
    "reellab.messaging.send-window=1m",
    "reellab.messaging.page-size=10",
})
class MessagingIntegrationTest extends ApiIntegrationTest {

    @Autowired RequestRateLimiter limiter;

    private UserEntity alice;
    private UserEntity bob;
    private UserEntity carol;

    @BeforeEach
    void seed() {
        // The limiter is a singleton in a shared context, so one test's sends would
        // otherwise count against the next one's.
        limiter.clear();
        alice = user("alice");
        bob = user("bob");
        carol = user("carol");
    }

    // --- helpers ------------------------------------------------------------------

    private UUID openConversation(UserEntity as, UserEntity with) throws Exception {
        JsonNode body = okJson(post("/api/conversations")
                .header(HttpHeaders.AUTHORIZATION, bearer(as))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userId\":\"" + with.getId() + "\"}"));
        return UUID.fromString(body.get("id").asText());
    }

    private ResultActions send(UserEntity as, UUID conversationId, String text) throws Exception {
        return mvc.perform(post("/api/conversations/{id}/messages", conversationId)
                .header(HttpHeaders.AUTHORIZATION, bearer(as))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("body", text))));
    }

    private JsonNode pageOf(UserEntity as, UUID conversationId, String cursor, int limit)
            throws Exception {
        var request = get("/api/conversations/{id}/messages", conversationId)
                .header(HttpHeaders.AUTHORIZATION, bearer(as))
                .param("limit", String.valueOf(limit));
        if (cursor != null) {
            request = request.param("cursor", cursor);
        }
        return okJson(request);
    }

    // --- sending and reading ------------------------------------------------------

    @Test
    void twoPeopleExchangeMessagesInOneThread() throws Exception {
        UUID thread = openConversation(alice, bob);

        send(alice, thread, "hello").andExpect(status().isOk());
        send(bob, thread, "hi back").andExpect(status().isOk());

        JsonNode page = pageOf(alice, thread, null, 10);
        // Newest first, which is the order a thread renders in.
        assertThat(bodies(page.get("items"))).containsExactly("hi back", "hello");
    }

    /**
     * Opening the thread from either side finds the SAME row.
     *
     * <p>The pair is stored in a canonical order precisely so that two people who open a
     * conversation with each other at the same moment do not end up with one thread each,
     * talking past one another.
     */
    @Test
    void bothSidesOpenTheSameConversation() throws Exception {
        assertThat(openConversation(alice, bob)).isEqualTo(openConversation(bob, alice));
    }

    @Test
    void aMessageIsStoredAndReturnedAsPlainText() throws Exception {
        UUID thread = openConversation(alice, bob);
        String markup = "<b>bold</b> **stars** <script>alert(1)</script> & \"quotes\"";
        send(alice, thread, markup).andExpect(status().isOk());

        // Out of the database exactly as it went in — not escaped, not stripped, not
        // rewritten. Escaping here would corrupt a message that legitimately contains <b>;
        // the safety is that nothing on either side hands it to a markup parser.
        String stored = jdbc.queryForObject("select body from messages", String.class);
        assertThat(stored).isEqualTo(markup);

        JsonNode page = pageOf(alice, thread, null, 10);
        assertThat(page.get("items").get(0).get("body").asText()).isEqualTo(markup);
    }

    @Test
    void anEmptyOrOverlongMessageIsRefused() throws Exception {
        UUID thread = openConversation(alice, bob);
        // Blank is judged by the service, because whether it is allowed depends on whether
        // a clip is attached — see the sharing tests. Length is still the request's own rule.
        send(alice, thread, "   ").andExpect(status().isUnprocessableEntity());
        send(alice, thread, "x".repeat(4001)).andExpect(status().isBadRequest());
    }

    // --- authorization ------------------------------------------------------------

    /**
     * The criterion, sent directly at the API rather than through any screen.
     *
     * <p>A conversation id in a request is a CLAIM. Carol knows the id — she was handed it
     * here — and that must buy her nothing.
     */
    @Test
    void anOutsiderCannotReadOrWriteAConversationTheyAreNotIn() throws Exception {
        UUID thread = openConversation(alice, bob);

        mvc.perform(get("/api/conversations/{id}/messages", thread)
                        .header(HttpHeaders.AUTHORIZATION, bearer(carol)))
                .andExpect(status().isForbidden());

        send(carol, thread, "let me in").andExpect(status().isForbidden());

        mvc.perform(post("/api/conversations/{id}/read", thread)
                        .header(HttpHeaders.AUTHORIZATION, bearer(carol)))
                .andExpect(status().isForbidden());

        assertThat(detailOf(send(carol, thread, "again")))
                .isEqualTo(ConversationService.NOT_A_PARTICIPANT);
    }

    @Test
    void everyMessagingEndpointNeedsAToken() throws Exception {
        UUID thread = openConversation(alice, bob);

        mvc.perform(get("/api/conversations")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/conversations/{id}/messages", thread))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/conversations/{id}/messages", thread)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void youCannotOpenAConversationWithYourself() throws Exception {
        assertThat(detailOf(mvc.perform(post("/api/conversations")
                .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userId\":\"" + alice.getId() + "\"}"))))
                .isEqualTo(ConversationService.NO_SELF_CONVERSATION);
    }

    // --- unread -------------------------------------------------------------------

    @Test
    void unreadCountsAreAccurateAndClearWhenTheThreadIsOpened() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(bob, thread, "one");
        send(bob, thread, "two");

        assertThat(unreadFor(alice, thread)).isEqualTo(2);
        // Your own messages are never unread to you.
        assertThat(unreadFor(bob, thread)).isZero();

        mvc.perform(post("/api/conversations/{id}/read", thread)
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice)))
                .andExpect(status().isOk());
        assertThat(unreadFor(alice, thread)).isZero();

        // And a message that arrives AFTER the read counts again.
        send(bob, thread, "three");
        assertThat(unreadFor(alice, thread)).isEqualTo(1);
    }

    @Test
    void theConversationListCarriesTheLastMessageAndTheOtherPerson() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(bob, thread, "first");
        send(alice, thread, "last one");

        JsonNode list = okJson(get("/api/conversations")
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        assertThat(list).hasSize(1);
        JsonNode row = list.get(0);
        assertThat(row.get("other").get("username").asText()).isEqualTo("bob");
        assertThat(row.get("lastMessage").get("body").asText()).isEqualTo("last one");
    }

    // --- receipts -----------------------------------------------------------------

    /**
     * The three ticks, in order: sent, delivered, seen.
     *
     * <p>Judged from the SENDER's side, because that is whose screen draws them: a page of the
     * thread carries the other participant's watermarks, and a message older than one of
     * them has earned that tick.
     */
    @Test
    void aMessageGoesFromSentToDeliveredToSeen() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(alice, thread, "are you there?").andExpect(status().isOk());

        // Bob has never received anything: no receipt at all, so every tick is "sent".
        assertThat(pageOf(alice, thread, null, 10).get("otherReceipt").isNull()).isTrue();

        // Bob's inbox loads — delivered, not read.
        JsonNode receipt = okJson(post("/api/conversations/{id}/delivered", thread)
                .header(HttpHeaders.AUTHORIZATION, bearer(bob)));
        assertThat(receipt.get("userId").asText()).isEqualTo(bob.getId().toString());
        assertThat(receipt.get("deliveredAt").isNull()).isFalse();
        assertThat(receipt.get("readAt").isNull()).isTrue();

        JsonNode page = pageOf(alice, thread, null, 10);
        String sentAt = page.get("items").get(0).get("createdAt").asText();
        JsonNode other = page.get("otherReceipt");
        assertThat(other.get("deliveredAt").asText()).isGreaterThanOrEqualTo(sentAt);
        assertThat(other.get("readAt").isNull()).isTrue();
        // Delivery does not read: Bob still has it unread.
        assertThat(unreadFor(bob, thread)).isEqualTo(1);

        // Bob opens the thread — seen.
        mvc.perform(post("/api/conversations/{id}/read", thread)
                        .header(HttpHeaders.AUTHORIZATION, bearer(bob)))
                .andExpect(status().isOk());
        other = pageOf(alice, thread, null, 10).get("otherReceipt");
        assertThat(other.get("readAt").asText()).isGreaterThanOrEqualTo(sentAt);
        // And reading implies delivery, whatever the device managed to say first.
        assertThat(other.get("deliveredAt").asText())
                .isGreaterThanOrEqualTo(other.get("readAt").asText());
    }

    /** Reading straight away, with no delivery receipt first, still yields both watermarks. */
    @Test
    void readingImpliesDelivery() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(alice, thread, "hi").andExpect(status().isOk());

        mvc.perform(post("/api/conversations/{id}/read", thread)
                        .header(HttpHeaders.AUTHORIZATION, bearer(bob)))
                .andExpect(status().isOk());

        JsonNode other = pageOf(alice, thread, null, 10).get("otherReceipt");
        assertThat(other.get("deliveredAt").asText()).isEqualTo(other.get("readAt").asText());
    }

    /**
     * The inbox's one call: every thread with something new is delivered, and only those.
     *
     * <p>Only those, because each one is a frame to the other participant. A second call
     * with nothing new produces nothing — the server does not repeat itself.
     */
    @Test
    void deliveringEverythingTouchesOnlyThreadsWithSomethingNew() throws Exception {
        UUID withAlice = openConversation(bob, alice);
        UUID withCarol = openConversation(bob, carol);
        send(alice, withAlice, "from alice").andExpect(status().isOk());
        // Carol's thread exists but nobody has written in it.

        JsonNode moved = okJson(post("/api/conversations/delivered")
                .header(HttpHeaders.AUTHORIZATION, bearer(bob)));
        assertThat(moved).hasSize(1);
        assertThat(moved.get(0).get("conversationId").asText()).isEqualTo(withAlice.toString());

        // The list ticks Alice's own last message as delivered.
        JsonNode list = okJson(get("/api/conversations")
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        assertThat(list.get(0).get("otherReceipt").get("deliveredAt").isNull()).isFalse();
        assertThat(list.get(0).get("otherReceipt").get("readAt").isNull()).isTrue();

        // Nothing new: nothing moves.
        assertThat(okJson(post("/api/conversations/delivered")
                .header(HttpHeaders.AUTHORIZATION, bearer(bob)))).isEmpty();

        // Something new in Carol's thread: exactly that one moves.
        send(carol, withCarol, "from carol").andExpect(status().isOk());
        moved = okJson(post("/api/conversations/delivered")
                .header(HttpHeaders.AUTHORIZATION, bearer(bob)));
        assertThat(moved).hasSize(1);
        assertThat(moved.get(0).get("conversationId").asText()).isEqualTo(withCarol.toString());
    }

    /** A receipt is a claim about a thread, and an outsider's claim buys nothing. */
    @Test
    void anOutsiderCannotMarkAThreadDelivered() throws Exception {
        UUID thread = openConversation(alice, bob);
        mvc.perform(post("/api/conversations/{id}/delivered", thread)
                        .header(HttpHeaders.AUTHORIZATION, bearer(carol)))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/conversations/{id}/delivered", thread))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/conversations/delivered")).andExpect(status().isUnauthorized());
    }

    // --- sharing a clip -----------------------------------------------------------

    private ResultActions share(UserEntity as, UUID conversationId, UUID videoId, String text)
            throws Exception {
        return mvc.perform(post("/api/conversations/{id}/messages", conversationId)
                .header(HttpHeaders.AUTHORIZATION, bearer(as))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(
                        Map.of("body", text, "videoId", videoId.toString()))));
    }

    /**
     * A clip from the feed lands in the thread as a card: title, owner, and what it takes to
     * play it. No words needed — the clip is the message.
     */
    @Test
    void aSharedVideoArrivesAsACardWithoutNeedingText() throws Exception {
        UUID thread = openConversation(alice, bob);
        VideoEntity clip = publishedVideo(carol, "Sunset");

        JsonNode sent = okJson(post("/api/conversations/{id}/messages", thread)
                .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(
                        Map.of("body", "", "videoId", clip.getId().toString()))));
        assertThat(sent.get("body").asText()).isEmpty();
        assertThat(sent.get("video").get("title").asText()).isEqualTo("Sunset");
        assertThat(sent.get("videoRemoved").asBoolean()).isFalse();

        // From the other side, out of the database: the card is composed the same way.
        JsonNode item = pageOf(bob, thread, null, 10).get("items").get(0);
        assertThat(item.get("video").get("id").asText()).isEqualTo(clip.getId().toString());
        assertThat(item.get("video").get("owner").get("username").asText()).isEqualTo("carol");
        assertThat(item.get("video").get("manifestUrl").asText()).endsWith("/master.m3u8");

        // The inbox row carries it too, so the list can say "Video" rather than nothing.
        JsonNode list = okJson(get("/api/conversations")
                .header(HttpHeaders.AUTHORIZATION, bearer(bob)));
        assertThat(list.get(0).get("lastMessage").get("video").isNull()).isFalse();

        // With words as well, when there are any.
        share(alice, thread, clip.getId(), "look at this").andExpect(status().isOk());
        assertThat(bodies(pageOf(bob, thread, null, 10).get("items")))
                .containsExactly("look at this", "");
    }

    /**
     * Only a PUBLISHED clip can be shared, and an id is a claim.
     *
     * <p>A draft is visible to its owner alone; a message carrying it would be a way around
     * that. An unknown id and a draft get the same answer, so the endpoint cannot be used
     * to find out which drafts exist.
     */
    @Test
    void aDraftOrUnknownVideoCannotBeShared() throws Exception {
        UUID thread = openConversation(alice, bob);
        VideoEntity draft = videos.save(new VideoEntity(
                carol, "Draft", null, 30, UUID.randomUUID() + "/master.m3u8", null));

        assertThat(detailOf(share(alice, thread, draft.getId(), "")))
                .isEqualTo(MessageService.VIDEO_NOT_SHAREABLE);
        assertThat(detailOf(share(alice, thread, UUID.randomUUID(), "")))
                .isEqualTo(MessageService.VIDEO_NOT_SHAREABLE);
        // And no clip does not excuse an empty message.
        send(alice, thread, "").andExpect(status().isUnprocessableEntity());
        assertThat(pageOf(alice, thread, null, 10).get("items")).isEmpty();
    }

    /**
     * Deleting the clip does not delete the conversation.
     *
     * <p>The message stays and says the video is gone. Cascading it away would remove a
     * line of what two people said to each other because a third person cleaned up.
     */
    @Test
    void aDeletedVideoLeavesTheMessageSayingSo() throws Exception {
        UUID thread = openConversation(alice, bob);
        VideoEntity clip = publishedVideo(carol, "Gone soon");
        share(alice, thread, clip.getId(), "").andExpect(status().isOk());

        mvc.perform(delete("/api/videos/{id}", clip.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(carol)))
                .andExpect(status().isNoContent());

        JsonNode item = pageOf(bob, thread, null, 10).get("items").get(0);
        assertThat(item.get("video").isNull()).isTrue();
        assertThat(item.get("videoRemoved").asBoolean()).isTrue();
    }

    // --- paging -------------------------------------------------------------------

    /**
     * Pages the whole thread and asserts what a scrolling reader actually cares about: every
     * message exactly once, in order, with no gap.
     */
    @Test
    void olderMessagesPageInWithoutDuplicatesOrGaps() throws Exception {
        UUID thread = openConversation(alice, bob);
        for (int i = 0; i < 25; i++) {
            send(i % 2 == 0 ? alice : bob, thread, "message " + i);
            limiter.clear();
        }

        List<String> seen = new ArrayList<>();
        Set<String> unique = new LinkedHashSet<>();
        String cursor = null;
        int pages = 0;
        do {
            JsonNode page = pageOf(alice, thread, cursor, 7);
            List<String> bodies = bodies(page.get("items"));
            seen.addAll(bodies);
            unique.addAll(bodies);
            cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asText();
            pages++;
            assertThat(pages).as("must terminate").isLessThan(20);
        } while (cursor != null);

        assertThat(seen).as("no message appeared twice").hasSameSizeAs(unique);
        assertThat(seen).hasSize(25);
        // Newest first, all the way down — a gap would show as a missing index here.
        List<String> expected = new ArrayList<>();
        for (int i = 24; i >= 0; i--) {
            expected.add("message " + i);
        }
        assertThat(seen).containsExactlyElementsOf(expected);
    }

    /** The reconnect path: what arrived while the socket was down. */
    @Test
    void sinceReturnsExactlyWhatWasMissed() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(bob, thread, "before");
        String watermark = pageOf(alice, thread, null, 10)
                .get("items").get(0).get("createdAt").asText();

        send(bob, thread, "missed one");
        send(bob, thread, "missed two");

        JsonNode missed = okJson(get("/api/conversations/{id}/messages/since", thread)
                .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                .param("after", watermark));
        // Oldest first — they are appended to a thread the client already has.
        assertThat(bodies(missed)).containsExactly("missed one", "missed two");
    }

    // --- blocking -----------------------------------------------------------------

    @Test
    void aBlockedUserCannotSendAndTheBlockIsEnforcedOnTheServer() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(bob, thread, "before the block").andExpect(status().isOk());

        mvc.perform(put("/api/users/{id}/block", bob.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice)))
                .andExpect(status().isNoContent());

        // Bob's client knows nothing about the block; it still has the thread open and sends
        // straight at the API. This is the enforcement point.
        assertThat(detailOf(send(bob, thread, "after the block")))
                .isEqualTo(BlockService.BLOCKED);
        // And the blocker cannot write into it either — a block closes the thread, it does
        // not make it one-way.
        send(alice, thread, "and neither can I").andExpect(status().isForbidden());

        assertThat(jdbc.queryForObject("select count(*) from messages", Long.class))
                .as("nothing was written").isEqualTo(1);
    }

    @Test
    void aBlockedUserCannotStartAConversationEither() throws Exception {
        mvc.perform(put("/api/users/{id}/block", bob.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice)))
                .andExpect(status().isNoContent());

        mvc.perform(post("/api/conversations")
                        .header(HttpHeaders.AUTHORIZATION, bearer(bob))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"" + alice.getId() + "\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void unblockingReopensTheThread() throws Exception {
        UUID thread = openConversation(alice, bob);
        mvc.perform(put("/api/users/{id}/block", bob.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        send(bob, thread, "blocked").andExpect(status().isForbidden());

        mvc.perform(delete("/api/users/{id}/block", bob.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice)))
                .andExpect(status().isNoContent());
        send(bob, thread, "unblocked").andExpect(status().isOk());
    }

    @Test
    void theBlockListShowsWhoYouBlockedAndNotWhoBlockedYou() throws Exception {
        mvc.perform(put("/api/users/{id}/block", bob.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));

        assertThat(okJson(get("/api/blocks").header(HttpHeaders.AUTHORIZATION, bearer(alice))))
                .hasSize(1);
        // Bob is blocked, and must not be able to find that out from here.
        assertThat(okJson(get("/api/blocks").header(HttpHeaders.AUTHORIZATION, bearer(bob))).size())
                .isZero();
    }

    // --- rate limiting ------------------------------------------------------------

    @Test
    void aBurstBeyondTheLimitIsRejected() throws Exception {
        UUID thread = openConversation(alice, bob);
        for (int i = 0; i < 5; i++) {
            send(alice, thread, "burst " + i).andExpect(status().isOk());
        }
        assertThat(detailOf(send(alice, thread, "one too many")))
                .isEqualTo(MessageService.RATE_LIMITED);

        // Per user, not per conversation: the same sender is still limited in another thread.
        UUID other = openConversation(alice, carol);
        send(alice, other, "different thread").andExpect(status().isTooManyRequests());
        // And the limit is the sender's own — bob is unaffected.
        send(bob, thread, "not me").andExpect(status().isOk());
    }

    // --- reporting ----------------------------------------------------------------

    @Test
    void reportingRecordsTheMessageTheReporterAndWhatTheySaw() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(bob, thread, "something awful");
        String messageId = pageOf(alice, thread, null, 10)
                .get("items").get(0).get("id").asText();

        okJson(post("/api/messages/{id}/report", messageId)
                .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"abuse\"}"));

        Map<String, Object> row = jdbc.queryForMap("select * from message_reports");
        assertThat(row.get("reporter_id").toString()).isEqualTo(alice.getId().toString());
        // A snapshot, so the complaint survives the message being edited or deleted.
        assertThat(row.get("body_at_report")).isEqualTo("something awful");
        assertThat(row.get("reason")).isEqualTo("abuse");

        // Reporting twice is the same complaint twice.
        okJson(post("/api/messages/{id}/report", messageId)
                .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"again\"}"));
        assertThat(jdbc.queryForObject("select count(*) from message_reports", Long.class))
                .isEqualTo(1);
    }

    @Test
    void youCannotReportAMessageFromAThreadYouAreNotIn() throws Exception {
        UUID thread = openConversation(alice, bob);
        send(bob, thread, "private");
        String messageId = pageOf(alice, thread, null, 10)
                .get("items").get(0).get("id").asText();

        mvc.perform(post("/api/messages/{id}/report", messageId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(carol))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"fishing\"}"))
                .andExpect(status().isForbidden());
    }

    private long unreadFor(UserEntity as, UUID conversationId) throws Exception {
        for (JsonNode row : okJson(get("/api/conversations")
                .header(HttpHeaders.AUTHORIZATION, bearer(as)))) {
            if (row.get("id").asText().equals(conversationId.toString())) {
                return row.get("unreadCount").asLong();
            }
        }
        throw new AssertionError("conversation not in the list");
    }

    private static List<String> bodies(JsonNode items) {
        List<String> out = new ArrayList<>();
        items.forEach(item -> out.add(item.get("body").asText()));
        return out;
    }
}
