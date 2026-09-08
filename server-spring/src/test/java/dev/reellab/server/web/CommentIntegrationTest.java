package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.CommentEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;

/**
 * Comments over real HTTP against real Postgres. The point of most of these is the
 * one-comment-per-author rule, which is enforced in two places on purpose: a service
 * pre-check for the message, and a database constraint for the guarantee.
 */
class CommentIntegrationTest extends ApiIntegrationTest {

    private UserEntity alice;
    private UserEntity bob;
    private VideoEntity video;

    @BeforeEach
    void seed() {
        alice = user("alice");
        bob = user("bob");
        video = publishedVideo(alice, "clip");
    }

    // --- the rule ----------------------------------------------------------------

    @Test
    void secondTopLevelCommentBySameAuthorIs409WithAUsefulMessage() throws Exception {
        comment(alice, null, "first").andExpect(status().isOk());

        String detail = detailOf(comment(alice, null, "second").andExpect(status().isConflict()));

        assertThat(detail)
                .contains("already commented")
                // The message has to say what to do instead, or a 409 is a dead end.
                .contains("Edit");
    }

    @Test
    void secondReplyToTheSameParentBySameAuthorIs409() throws Exception {
        UUID root = idOf(comment(bob, null, "root"));
        comment(alice, root, "my reply").andExpect(status().isOk());

        String detail = detailOf(comment(alice, root, "again").andExpect(status().isConflict()));

        assertThat(detail).contains("already replied").contains("Edit");
    }

    @Test
    void theRuleIsPerAuthorPerVideoAndPerParent() throws Exception {
        UUID root = idOf(comment(alice, null, "alice root"));

        // A different author on the same video: allowed.
        comment(bob, null, "bob root").andExpect(status().isOk());
        // The same author replying to a root, having already commented at top level: allowed,
        // because a reply and a top-level comment are different slots.
        comment(alice, root, "alice replying to herself").andExpect(status().isOk());

        UUID otherVideo = videos.save(new VideoEntity(alice, "other", null, 10, "o/m.m3u8", null))
                .getId();
        // The same author on a different video: allowed.
        mvc.perform(post("/api/videos/{id}/comments", otherVideo)
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(null, "elsewhere")))
                .andExpect(status().isOk());
    }

    /**
     * The acceptance criterion that matters most: this never calls the service, so the
     * pre-check cannot be what rejects it. Two rows are inserted straight through the
     * repository, and the database is the only thing left to say no.
     *
     * <p>Delete the constraint from V3 and this test fails while every 409 test above still
     * passes — which is exactly the failure mode it exists to catch.
     */
    @Test
    void theDatabaseConstraintRejectsADuplicateEvenWithNoServiceInvolved() {
        comments.saveAndFlush(new CommentEntity(video, alice, null, "first"));

        assertThatThrownBy(
                        () -> comments.saveAndFlush(new CommentEntity(video, alice, null, "second")))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("comments_one_per_author_uq");
    }

    @Test
    void aDuplicateThatSlipsPastThePreCheckIsStillA409NotA500() throws Exception {
        // Insert behind the service's back, so its pre-check sees nothing and the request
        // reaches the constraint — the shape a lost race takes.
        comments.saveAndFlush(new CommentEntity(video, alice, null, "already here"));

        String detail = detailOf(comment(alice, null, "racing").andExpect(status().isConflict()));

        assertThat(detail).contains("already commented");
    }

    // --- editing -----------------------------------------------------------------

    @Test
    void editingAnExistingCommentIsAllowedAndDoesNotCountAsANewOne() throws Exception {
        UUID id = idOf(comment(alice, null, "first draft"));

        mvc.perform(patch("/api/comments/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"second thoughts\"}"))
                .andExpect(status().isOk());

        JsonNode page = thread(null, 20);
        assertThat(page.get("items")).hasSize(1);
        assertThat(page.get("items").get(0).get("body").asText()).isEqualTo("second thoughts");

        // And the slot is still taken — editing did not free it up.
        comment(alice, null, "a third").andExpect(status().isConflict());
    }

    @Test
    void editingRejectsABlankBody() throws Exception {
        UUID id = idOf(comment(alice, null, "something"));

        mvc.perform(patch("/api/comments/{id}", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"   \"}"))
                .andExpect(status().isBadRequest());
    }

    // --- storage and rendering ----------------------------------------------------

    @Test
    void bodiesAreStoredAndReturnedAsPlainTextWithMarkupUninterpreted() throws Exception {
        String markup = "<b>bold</b> & <script>alert(1)</script> **stars** [link](x)";

        comment(alice, null, markup).andExpect(status().isOk());

        // Byte for byte out of the API...
        JsonNode item = thread(null, 20).get("items").get(0);
        assertThat(item.get("body").asText()).isEqualTo(markup);

        // ...and byte for byte in the column. Nothing escaped it on the way in either.
        String stored = jdbc.queryForObject("select body from comments", String.class);
        assertThat(stored).isEqualTo(markup);
    }

    // --- pagination ---------------------------------------------------------------

    @Test
    void rootsArePaginatedOldestFirstAndRepliesComeBackNestedOneLevel() throws Exception {
        // One root per author, since one author cannot leave two.
        List<String> expected = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            UserEntity author = user("user" + i);
            expected.add("root-" + i);
            comment(author, null, "root-" + i).andExpect(status().isOk());
        }

        PagedWalk walk = walkPages(this::thread, "body", 3);

        assertThat(walk.pages()).isEqualTo(3);
        assertThat(walk.values()).containsExactlyElementsOf(expected);
    }

    @Test
    void repliesAreNestedUnderTheirRootAndNeverNestDeeper() throws Exception {
        UUID root = idOf(comment(alice, null, "root"));
        UUID reply = idOf(comment(bob, root, "a reply"));

        JsonNode item = thread(null, 20).get("items").get(0);
        assertThat(item.get("replies")).hasSize(1);
        assertThat(item.get("replies").get(0).get("body").asText()).isEqualTo("a reply");
        // A reply carries no replies of its own — the tree stops here.
        assertThat(item.get("replies").get(0).get("replies")).isEmpty();

        // And the server refuses to create a third level at all.
        UserEntity carol = user("carol");
        mvc.perform(post("/api/videos/{id}/comments", video.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(carol))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(reply, "reply to a reply")))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void anEmptyThreadIsAnEmptyPageWithNoCursor() throws Exception {
        JsonNode empty = thread(null, 20);
        assertThat(empty.get("items")).isEmpty();
        assertThat(empty.get("hasNext").asBoolean()).isFalse();
        assertThat(empty.get("nextCursor").isNull()).isTrue();
    }

    @Test
    void unknownVideoIs404AndABadCursorIs400() throws Exception {
        mvc.perform(get("/api/videos/{id}/comments", UUID.randomUUID()))
                .andExpect(status().isNotFound());

        mvc.perform(get("/api/videos/{id}/comments", video.getId()).param("cursor", "not base64!!"))
                .andExpect(status().isBadRequest());
    }

    // --- helpers -------------------------------------------------------------------

    private ResultActions comment(
            UserEntity author, UUID parentId, String text) throws Exception {
        return mvc.perform(post("/api/videos/{id}/comments", video.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(parentId, text)));
    }

    /** Jackson does the escaping, so a body containing markup or quotes stays intact. */
    private String body(UUID parentId, String text) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("parentId", parentId == null ? null : parentId.toString());
        fields.put("body", text);
        return json.writeValueAsString(fields);
    }

    private JsonNode thread(String cursor, int limit) throws Exception {
        var request = get("/api/videos/{id}/comments", video.getId())
                .param("limit", String.valueOf(limit));
        if (cursor != null) {
            request = request.param("cursor", cursor);
        }
        return okJson(request);
    }

    private UUID idOf(ResultActions actions) throws Exception {
        String body = actions.andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.readTree(body).get("id").asText());
    }

}
