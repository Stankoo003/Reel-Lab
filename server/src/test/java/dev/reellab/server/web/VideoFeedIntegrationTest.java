package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.config.MediaProperties;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

/**
 * Exercises the feed and detail endpoints over real HTTP against a real Postgres — the
 * Flyway schema, the keyset query and the JSON contract, not mocks of them.
 */
class VideoFeedIntegrationTest extends ApiIntegrationTest {

    /**
     * Truncated to microseconds because that is all timestamptz stores. Without this the
     * value a test writes and the value a cursor round-trips would differ in the nanos,
     * and the keyset equality branch would silently never match.
     */
    private static final Instant BASE =
            Instant.parse("2026-01-01T12:00:00Z").truncatedTo(ChronoUnit.MICROS);

    @Autowired private MediaProperties mediaProperties;

    private UserEntity owner;

    @BeforeEach
    void seedOwner() {
        owner = user("feeduser");
    }

    @Test
    void feedWalksEveryPublishedVideoExactlyOnceInNewestFirstOrder() throws Exception {
        List<String> expected = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            expected.add(publish("video-%02d".formatted(i), BASE.minusSeconds(i)).getTitle());
        }

        PagedWalk walk = walkPages(this::feed, "title", 5);

        assertThat(walk.pages()).isEqualTo(3);
        assertThat(walk.values()).containsExactlyElementsOf(expected);
    }

    @Test
    void lastPageReportsNoNextCursor() throws Exception {
        publish("only", BASE);

        JsonNode page = feed(null, 5);

        assertThat(page.get("hasNext").asBoolean()).isFalse();
        assertThat(page.get("nextCursor").isNull()).isTrue();
        assertThat(page.get("items")).hasSize(1);
    }

    @Test
    void videosSharingATimestampAreNeitherSkippedNorRepeated() throws Exception {
        // The case a created_at-only cursor gets wrong: rows written in one transaction
        // share now(), so id has to complete the ordering.
        for (int i = 0; i < 6; i++) {
            publish("tied-%d".formatted(i), BASE);
        }

        assertThat(walkTitles(2)).hasSize(6).containsOnlyOnce(
                "tied-0", "tied-1", "tied-2", "tied-3", "tied-4", "tied-5");
    }

    @Test
    void publishingDuringAWalkDoesNotShiftPagesAlreadyRead() throws Exception {
        for (int i = 0; i < 6; i++) {
            publish("old-%02d".formatted(i), BASE.minusSeconds(i));
        }

        JsonNode first = feed(null, 3);
        List<String> firstTitles = titles(first);

        // A newer video arrives between requests. With offsets this would push a row from
        // page 1 onto page 2 and the reader would see it twice.
        publish("brand-new", BASE.plusSeconds(60));

        List<String> second = titles(feed(first.get("nextCursor").asText(), 3));

        assertThat(firstTitles).containsExactly("old-00", "old-01", "old-02");
        assertThat(second).containsExactly("old-03", "old-04", "old-05");
    }

    @Test
    void unpublishedVideosNeverAppearInTheFeed() throws Exception {
        publish("published", BASE);
        VideoEntity draft = videos.save(newVideo("draft"));
        setCreatedAt(draft.getId(), BASE.plusSeconds(10));

        assertThat(walkTitles(10)).containsExactly("published");
    }

    @Test
    void itemsAreDtosAndDoNotLeakEntityInternals() throws Exception {
        publish("dto-shape", BASE);

        JsonNode item = feed(null, 5).get("items").get(0);

        // Not merely "starts with http": the CDN base must be prepended to the stored
        // relative path, with exactly one separator. That composition is the whole reason
        // MediaUrlAssembler exists, and this is the only test that sees its output.
        assertThat(item.get("manifestUrl").asText())
                .isEqualTo(cdnBase() + "/dto-shape/master.m3u8");
        assertThat(item.has("manifestPath")).isFalse();
        assertThat(item.has("posterPath")).isFalse();
        // The owner is projected through UserResponse, which has no email field.
        assertThat(item.get("owner").has("email")).isFalse();
        assertThat(item.get("owner").get("username").asText()).isEqualTo("feeduser");
    }

    @Test
    void unknownVideoIdIs404WithAProblemDetailBody() throws Exception {
        String body = mvc.perform(get("/api/videos/{id}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();

        // Names the thing that was missing, so the message is usable rather than merely present.
        assertThat(json.readTree(body).get("detail").asText()).contains("Video").contains("not found");
    }

    @Test
    void knownVideoIdReturnsTheDetailDto() throws Exception {
        VideoEntity video = publish("detail", BASE);

        String body = mvc.perform(get("/api/videos/{id}", video.getId()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        JsonNode detail = json.readTree(body);
        assertThat(detail.get("id").asText()).isEqualTo(video.getId().toString());
        assertThat(detail.get("title").asText()).isEqualTo("detail");
        assertThat(detail.has("manifestPath")).isFalse();
    }

    @Test
    void malformedVideoIdIs400NotAConversionStackTrace() throws Exception {
        assertThat(detailOfBadRequest(get("/api/videos/{id}", "not-a-uuid")))
                .contains("id must be a valid UUID");
    }

    // Asserting on the bound, not just on the word "limit": both tests used to pass with the
    // @Min and @Max swapped, which made them one test written twice.
    @Test
    void limitBelowRangeIs400() throws Exception {
        assertThat(detailOfBadRequest(get("/api/videos/feed").param("limit", "0")))
                .contains("limit")
                .contains("greater than or equal to 1");
    }

    @Test
    void limitAboveRangeIs400() throws Exception {
        assertThat(detailOfBadRequest(get("/api/videos/feed").param("limit", "51")))
                .contains("limit")
                .contains("less than or equal to 50");
    }

    @Test
    void cursorThatIsNotBase64Is400() throws Exception {
        assertThat(detailOfBadRequest(get("/api/videos/feed").param("cursor", "not base64!!")))
                .contains("cursor");
    }

    @Test
    void wellFormedBase64ThatIsNotACursorIs400() throws Exception {
        String encoded = java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString("totally|bogus".getBytes(java.nio.charset.StandardCharsets.UTF_8));

        assertThat(detailOfBadRequest(get("/api/videos/feed").param("cursor", encoded)))
                .contains("cursor");
    }

    // --- helpers -----------------------------------------------------------------

    private JsonNode feed(String cursor, int limit) throws Exception {
        var request = get("/api/videos/feed").param("limit", String.valueOf(limit));
        if (cursor != null) {
            request = request.param("cursor", cursor);
        }
        return okJson(request);
    }

    /** The configured CDN base, so the URL assertion is not a second copy of the config. */
    private String cdnBase() {
        return mediaProperties.cdnBaseUrl();
    }

    /** Follows nextCursor to exhaustion and returns every title in the order received. */
    private List<String> walkTitles(int limit) throws Exception {
        return walkPages(this::feed, "title", limit).values();
    }

    private List<String> titles(JsonNode page) {
        List<String> titles = new ArrayList<>();
        page.get("items").forEach(item -> titles.add(item.get("title").asText()));
        return titles;
    }

    private String detailOfBadRequest(RequestBuilder request) throws Exception {
        return detailOf(mvc.perform(request).andExpect(status().isBadRequest()));
    }

    private VideoEntity publish(String title, Instant createdAt) {
        VideoEntity video = newVideo(title);
        video.setPublished(true);
        VideoEntity saved = videos.save(video);
        setCreatedAt(saved.getId(), createdAt);
        return saved;
    }

    private VideoEntity newVideo(String title) {
        return new VideoEntity(owner, title, "description of " + title, 30,
                title + "/master.m3u8", title + "/poster.jpg");
    }

    /**
     * created_at is audit-managed and not updatable through JPA, so ordering fixtures are
     * written directly. Tests that need a deterministic order cannot rely on now().
     */
    private void setCreatedAt(UUID id, Instant createdAt) {
        // OffsetDateTime, not Timestamp: the driver maps it to timestamptz without
        // routing the value through the JVM default time zone.
        jdbc.update("update videos set created_at = ? where id = ?",
                java.time.OffsetDateTime.ofInstant(createdAt, java.time.ZoneOffset.UTC), id);
    }
}
