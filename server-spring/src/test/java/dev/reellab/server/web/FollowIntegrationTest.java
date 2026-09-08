package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.service.FollowService;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import tools.jackson.databind.JsonNode;

/** Following another user, and where that shows up afterwards. */
class FollowIntegrationTest extends ApiIntegrationTest {

    private UserEntity alice;
    private UserEntity bob;

    @BeforeEach
    void seed() {
        alice = user("alice");
        bob = user("bob");
    }

    private JsonNode followAsAlice(UUID target) throws Exception {
        return okJson(put("/api/users/{id}/follow", target)
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
    }

    private JsonNode unfollowAsAlice(UUID target) throws Exception {
        return okJson(delete("/api/users/{id}/follow", target)
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
    }

    // --- the state machine --------------------------------------------------------

    @Test
    void followingSomeoneReportsTheStateThatNowHolds() throws Exception {
        JsonNode body = followAsAlice(bob.getId());

        assertThat(body.get("userId").asText()).isEqualTo(bob.getId().toString());
        assertThat(body.get("followedByViewer").asBoolean()).isTrue();
        assertThat(body.get("followers").asLong()).isEqualTo(1);
        // Bob follows nobody — the response is about him, not about the viewer.
        assertThat(body.get("following").asLong()).isZero();
    }

    /**
     * A Follow button flips before the server has answered, so it will replay itself on a
     * slow connection. If the second request errored, the button would snap back to the
     * wrong state after a retry that in fact succeeded.
     */
    @Test
    void followingTwiceIsNotAnErrorAndDoesNotDoubleTheCount() throws Exception {
        followAsAlice(bob.getId());
        JsonNode again = followAsAlice(bob.getId());

        assertThat(again.get("followedByViewer").asBoolean()).isTrue();
        assertThat(again.get("followers").asLong()).isEqualTo(1);
    }

    @Test
    void unfollowingRemovesItAndIsAlsoIdempotent() throws Exception {
        followAsAlice(bob.getId());

        JsonNode gone = unfollowAsAlice(bob.getId());
        assertThat(gone.get("followedByViewer").asBoolean()).isFalse();
        assertThat(gone.get("followers").asLong()).isZero();

        // Unfollowing what is not followed cannot push the count below the truth.
        JsonNode again = unfollowAsAlice(bob.getId());
        assertThat(again.get("followers").asLong()).isZero();
    }

    @Test
    void youCannotFollowYourself() throws Exception {
        String detail = detailOf(mvc.perform(put("/api/users/{id}/follow", alice.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice))));
        assertThat(detail).isEqualTo(FollowService.CANNOT_FOLLOW_SELF);
    }

    @Test
    void followingSomebodyWhoDoesNotExistIs404() throws Exception {
        mvc.perform(put("/api/users/{id}/follow", UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice)))
                .andExpect(status().isNotFound());
    }

    /** Writes need a token, here as everywhere else. Following is not a read. */
    @Test
    void followingNeedsAToken() throws Exception {
        mvc.perform(put("/api/users/{id}/follow", bob.getId()))
                .andExpect(status().isUnauthorized());
    }

    // --- where it shows up --------------------------------------------------------

    @Test
    void aProfileCarriesItsFollowCountsAndWhetherTheViewerFollowsIt() throws Exception {
        followAsAlice(bob.getId());

        JsonNode asAlice = okJson(get("/api/users/{id}/profile", bob.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        assertThat(asAlice.get("followedByViewer").asBoolean()).isTrue();
        assertThat(asAlice.get("activity").get("followers").asLong()).isEqualTo(1);
        assertThat(asAlice.get("activity").get("following").asLong()).isZero();

        // Alice's own profile shows the other side of the same relationship.
        JsonNode aliceProfile = okJson(get("/api/users/{id}/profile", alice.getId()));
        assertThat(aliceProfile.get("activity").get("following").asLong()).isEqualTo(1);
        assertThat(aliceProfile.get("activity").get("followers").asLong()).isZero();
    }

    /**
     * The question is about the asker, so it has no answer without one — and the counts,
     * which are about the user being looked at, must still be right.
     */
    @Test
    void signedOutAProfileStillLoadsAndFollowedByViewerIsFalse() throws Exception {
        followAsAlice(bob.getId());

        JsonNode anonymous = okJson(get("/api/users/{id}/profile", bob.getId()));
        assertThat(anonymous.get("followedByViewer").asBoolean()).isFalse();
        assertThat(anonymous.get("activity").get("followers").asLong()).isEqualTo(1);
    }

    @Test
    void yourOwnProfileNeverSaysYouFollowYourself() throws Exception {
        JsonNode mine = okJson(get("/api/users/{id}/profile", alice.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        assertThat(mine.get("followedByViewer").asBoolean()).isFalse();
    }

    /** What the feed's "Following" label under a clip is drawn from. */
    @Test
    void theFeedSaysWhetherYouFollowEachClipsAuthor() throws Exception {
        publishedVideo(bob, "bob's clip");
        UserEntity carol = user("carol");
        publishedVideo(carol, "carol's clip");
        followAsAlice(bob.getId());

        JsonNode feed = okJson(get("/api/videos/feed")
                .param("limit", "10")
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));

        boolean sawBob = false;
        boolean sawCarol = false;
        for (JsonNode item : feed.get("items")) {
            String owner = item.get("owner").get("username").asText();
            boolean followed = item.get("ownerFollowedByViewer").asBoolean();
            if (owner.equals("bob")) {
                sawBob = true;
                assertThat(followed).as("alice follows bob").isTrue();
            }
            if (owner.equals("carol")) {
                sawCarol = true;
                assertThat(followed).as("alice does not follow carol").isFalse();
            }
        }
        // Without this the loop could assert nothing at all and still pass.
        assertThat(sawBob && sawCarol).as("both clips must be in the feed").isTrue();
    }

    @Test
    void signedOutTheFeedSaysYouFollowNobody() throws Exception {
        publishedVideo(bob, "clip");
        followAsAlice(bob.getId());

        JsonNode feed = okJson(get("/api/videos/feed").param("limit", "10"));
        assertThat(feed.get("items").get(0).get("ownerFollowedByViewer").asBoolean()).isFalse();
    }

    /** The profile grid on someone else's page reads this endpoint. */
    @Test
    void aUsersOwnVideosCarryTheSameFollowFlag() throws Exception {
        VideoEntity video = publishedVideo(bob, "clip");
        followAsAlice(bob.getId());

        JsonNode listed = okJson(get("/api/videos")
                .param("ownerId", bob.getId().toString())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        assertThat(listed.get("content").get(0).get("ownerFollowedByViewer").asBoolean()).isTrue();

        JsonNode one = okJson(get("/api/videos/{id}", video.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        assertThat(one.get("ownerFollowedByViewer").asBoolean()).isTrue();
    }

    @Test
    void followingNobodyLeavesEveryCountAtZero() throws Exception {
        JsonNode profile = okJson(get("/api/users/{id}/profile", bob.getId()));
        assertThat(profile.get("activity").get("followers").asLong()).isZero();
        assertThat(profile.get("activity").get("following").asLong()).isZero();
    }
}
