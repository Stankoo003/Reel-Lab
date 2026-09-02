package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.persistence.entity.VideoLikeEntity;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

class VideoLikeIntegrationTest extends ApiIntegrationTest {

    private UserEntity alice;
    private UserEntity bob;
    private VideoEntity video;

    @BeforeEach
    void seed() {
        alice = user("alice");
        bob = user("bob");
        video = publishedVideo(alice, "clip");
    }

    // --- the constraint -------------------------------------------------------------

    /**
     * The acceptance criterion: this never goes through {@link
     * dev.reellab.server.service.VideoLikeService}, so its pre-check cannot be what rejects
     * the second row. Two inserts straight through the repository, and the database is the
     * only thing left to say no.
     *
     * <p>Drop the constraint from V4 and this fails while every endpoint test below still
     * passes — the service would happily keep one like per user on its own, right up until
     * two requests raced.
     */
    @Test
    void theDatabaseRejectsADuplicateLikeWithNoServiceInvolved() {
        likes.saveAndFlush(new VideoLikeEntity(video, alice));

        assertThatThrownBy(() -> likes.saveAndFlush(new VideoLikeEntity(video, alice)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("video_likes_one_per_user_uq");
    }

    @Test
    void theConstraintIsPerUserAndPerVideoNotGlobal() {
        likes.saveAndFlush(new VideoLikeEntity(video, alice));

        // A different user on the same video, and the same user on a different video.
        likes.saveAndFlush(new VideoLikeEntity(video, bob));
        VideoEntity other = videos.save(
                new VideoEntity(alice, "other", null, 10, "o/master.m3u8", null));
        likes.saveAndFlush(new VideoLikeEntity(other, alice));

        assertThat(likes.countByVideoId(video.getId())).isEqualTo(2);
        assertThat(likes.countByVideoId(other.getId())).isEqualTo(1);
    }

    // --- liking and unliking ---------------------------------------------------------

    @Test
    void likingThenUnlikingLeavesNoRowAndLikingAgainIsAllowed() throws Exception {
        assertThat(likeState(like(alice))).isEqualTo("1/true");

        // Unliking removes the row outright rather than flagging it.
        assertThat(likeState(unlike(alice))).isEqualTo("0/false");
        assertThat(likes.existsByVideoIdAndUserId(video.getId(), alice.getId())).isFalse();

        // The constraint prevents duplicates, not repeat toggling.
        assertThat(likeState(like(alice))).isEqualTo("1/true");
    }

    @Test
    void likingIsIdempotentSoARetryDoesNotInflateTheCount() throws Exception {
        like(alice);
        like(alice);
        assertThat(likeState(like(alice))).isEqualTo("1/true");
        assertThat(likes.countByVideoId(video.getId())).isEqualTo(1);
    }

    @Test
    void unlikingSomethingNotLikedIsANoOpAndCannotDriveTheCountNegative() throws Exception {
        like(bob);

        assertThat(likeState(unlike(alice))).isEqualTo("1/false");
        assertThat(likes.countByVideoId(video.getId())).isEqualTo(1);
    }

    /**
     * The drift criterion. A client toggling fast sends these back to back; whatever order
     * they arrive in, the count must equal what the last one asked for — never a running
     * total of the requests.
     */
    @Test
    void rapidTogglingLeavesTheCountAccurate() throws Exception {
        for (int i = 0; i < 12; i++) {
            like(alice);
            unlike(alice);
        }
        assertThat(likeState(like(alice))).isEqualTo("1/true");
        assertThat(likes.countByVideoId(video.getId())).isEqualTo(1);

        assertThat(likeState(unlike(alice))).isEqualTo("0/false");
        assertThat(likes.countByVideoId(video.getId())).isZero();
    }

    /**
     * Two inserts of the same like, straight through the repository, with no service and so no
     * pre-check to short-circuit them — the shape a lost race takes.
     *
     * <p>The previous version of this test inserted the row and then called the endpoint, so
     * the pre-check found it and returned before reaching the conflict path at all. It passed
     * while the code it claimed to cover could not have worked: catching the violation in Java
     * leaves the transaction aborted, so the recovery query and the count both fail.
     */
    // @Transactional because a @Modifying query needs one; in production the service supplies
    // it. The rollback afterwards is harmless — every assertion is inside.
    @Test
    @Transactional
    void aSecondInsertOfTheSameLikeIsAbsorbedByTheDatabaseWithoutAnError() {
        assertThat(likes.insertIgnoringDuplicate(video.getId(), alice.getId())).isEqualTo(1);
        assertThat(likes.insertIgnoringDuplicate(video.getId(), alice.getId())).isZero();

        assertThat(likes.countByVideoId(video.getId())).isEqualTo(1);
    }

    @Test
    void likingAfterARowAlreadyExistsStillReportsTheTruth() throws Exception {
        likes.saveAndFlush(new VideoLikeEntity(video, alice));

        assertThat(likeState(like(alice))).isEqualTo("1/true");
    }

    // --- counts in the feed -----------------------------------------------------------

    @Test
    void theFeedCarriesLikeCountsAndWhetherTheViewerLikedEach() throws Exception {
        like(alice);
        like(bob);

        JsonNode mine = feedItem(alice);
        assertThat(mine.get("likeCount").asLong()).isEqualTo(2);
        assertThat(mine.get("likedByViewer").asBoolean()).isTrue();

        UserEntity carol = user("carol");
        JsonNode theirs = feedItem(carol);
        assertThat(theirs.get("likeCount").asLong()).isEqualTo(2);
        assertThat(theirs.get("likedByViewer").asBoolean()).isFalse();
    }

    @Test
    void withNoViewerNamedTheCountIsStillRightAndLikedIsFalse() throws Exception {
        like(alice);

        JsonNode item = feedItem(null);
        assertThat(item.get("likeCount").asLong()).isEqualTo(1);
        assertThat(item.get("likedByViewer").asBoolean()).isFalse();
    }

    @Test
    void aVideoNobodyLikedReportsZeroRatherThanBeingAbsent() throws Exception {
        JsonNode item = feedItem(alice);
        assertThat(item.get("likeCount").asLong()).isZero();
        assertThat(item.get("likedByViewer").asBoolean()).isFalse();
    }

    @Test
    void likesSurviveARereadWhichIsWhatPersistenceAcrossRestartsRestsOn() throws Exception {
        like(alice);

        // Nothing cached in the request that produced it: a fresh read of the feed, and a
        // fresh read of the table underneath it, both still see the like.
        assertThat(feedItem(alice).get("likedByViewer").asBoolean()).isTrue();
        Long stored = jdbc.queryForObject(
                "select count(*) from video_likes where user_id = ? and video_id = ?",
                Long.class, alice.getId(), video.getId());
        assertThat(stored).isEqualTo(1);
    }

    @Test
    void likingAnUnknownVideoIs404AndAnUnknownUserIs404() throws Exception {
        mvc.perform(put("/api/videos/{id}/like", UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice)))
                .andExpect(status().isNotFound());

        // A user can no longer be named in the request, so "unknown user" now means a token
        // whose subject has since been deleted — a signed-in session outliving its account.
        UserEntity ghost = user("ghost");
        String ghostToken = bearer(ghost);
        users.delete(ghost);
        mvc.perform(put("/api/videos/{id}/like", video.getId())
                        .header(HttpHeaders.AUTHORIZATION, ghostToken))
                .andExpect(status().isNotFound());
    }

    /**
     * Replaces a test for a malformed userId query param. That parameter is gone, and the
     * failure it guarded against moved: a caller who sends rubbish now sends a rubbish
     * token, and the filter chain rejects it before any controller runs.
     */
    @Test
    void aMalformedTokenIs401() throws Exception {
        mvc.perform(put("/api/videos/{id}/like", video.getId())
                        .header(HttpHeaders.AUTHORIZATION, "Bearer not-a-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void likingWithNoTokenAtAllIs401() throws Exception {
        mvc.perform(put("/api/videos/{id}/like", video.getId()))
                .andExpect(status().isUnauthorized());
    }

    // --- helpers ------------------------------------------------------------------------

    private JsonNode like(UserEntity user) throws Exception {
        return json.readTree(
                mvc.perform(put("/api/videos/{id}/like", video.getId())
                                .header(HttpHeaders.AUTHORIZATION, bearer(user)))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString());
    }

    private JsonNode unlike(UserEntity user) throws Exception {
        return json.readTree(
                mvc.perform(delete("/api/videos/{id}/like", video.getId())
                                .header(HttpHeaders.AUTHORIZATION, bearer(user)))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString());
    }

    /** Compact "count/liked" so an assertion reads as one fact rather than two. */
    private String likeState(JsonNode response) {
        return response.get("likeCount").asLong() + "/" + response.get("likedByViewer").asBoolean();
    }

    private JsonNode feedItem(UserEntity viewer) throws Exception {
        var request = get("/api/videos/feed").param("limit", "10");
        if (viewer != null) {
            request = request.header(HttpHeaders.AUTHORIZATION, bearer(viewer));
        }
        return okJson(request).get("items").get(0);
    }
}
