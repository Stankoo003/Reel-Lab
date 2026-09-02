package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.CommentEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.persistence.entity.VideoLikeEntity;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;

class ProfileIntegrationTest extends ApiIntegrationTest {

    private static final byte[] PNG_HEADER =
            {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13};
    private static final byte[] JPEG_HEADER = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0};
    /** "RIFF" + size + "WEBP" — the only header that needs all 12 sniffed bytes. */
    private static final byte[] WEBP_HEADER =
            {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P'};

    private UserEntity alice;
    private UserEntity bob;

    @BeforeEach
    void seed() {
        alice = user("alice");
        bob = user("bob");
    }

    // --- what must never come back ------------------------------------------------

    /**
     * The whole point of the criterion, applied to every endpoint that returns a user rather
     * than only to the profile — a leak anywhere is a leak. The raw JSON is searched rather
     * than named fields inspected, so a field added later is caught too.
     */
    @Test
    void noEndpointThatReturnsAUserEverReturnsAnEmailOrACredential() throws Exception {
        VideoEntity video = publishedVideo(alice, "clip");
        comments.save(new CommentEntity(video, alice, null, "hello"));

        String[] bodies = {
            okBody(get("/api/users/{id}/profile", alice.getId())),
            okBody(get("/api/users/{id}", alice.getId())),
            okBody(get("/api/users")),
            okBody(get("/api/videos/feed").param("limit", "10")),
            okBody(get("/api/videos/{id}", video.getId())),
            okBody(get("/api/videos/{id}/comments", video.getId())),
        };

        for (String body : bodies) {
            // A positive control first. Every assertion below is a doesNotContain, so without
            // this the whole test passes on an empty body, a 204, or a response that regressed
            // to returning nothing — the strongest security assertion in the suite, neutered.
            assertThat(body).as("response must actually contain the user").contains("alice");

            String lower = body.toLowerCase(Locale.ROOT);
            assertThat(body).doesNotContain("alice@example.com").doesNotContain("bob@example.com");
            assertThat(lower)
                    .doesNotContain("\"email\"")
                    .doesNotContain("passwordhash")
                    .doesNotContain("\"password\"");
        }
    }

    /**
     * Naming yourself as the viewer changes nothing.
     *
     * <p>Without authentication a viewerId is a claim, not proof. If it unlocked private data,
     * anyone who knew a user's id could read it by claiming to be them — so the endpoint takes
     * no such parameter and one is ignored if sent. Asserting the two responses are equal is
     * only half of it; the point is that neither contains the email.
     */
    @Test
    void askingForYourOwnProfileDoesNotUnlockAnythingExtra() throws Exception {
        String asSelf = okBody(get("/api/users/{id}/profile", alice.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        String asOther = okBody(get("/api/users/{id}/profile", alice.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(bob)));

        assertThat(asSelf).isEqualTo(asOther);
        assertThat(asSelf).contains("alice").doesNotContain("alice@example.com");
    }

    // --- reading a profile ---------------------------------------------------------

    @Test
    void aProfileCarriesTheDisplayFieldsAndActivityCounts() throws Exception {
        VideoEntity one = publishedVideo(alice, "clip");
        VideoEntity two = publishedVideo(alice, "clip");
        // A draft: owned, but not published, so it is not part of a public count.
        videos.save(new VideoEntity(alice, "draft", null, 10, "d/master.m3u8", null));
        comments.save(new CommentEntity(one, alice, null, "mine"));
        likes.save(new VideoLikeEntity(one, bob));
        likes.save(new VideoLikeEntity(two, bob));

        JsonNode profile = json.readTree(okBody(get("/api/users/{id}/profile", alice.getId())));

        assertThat(profile.get("username").asText()).isEqualTo("alice");
        assertThat(profile.get("displayName").asText()).isEqualTo("Alice");
        assertThat(profile.get("activity").get("publishedVideos").asLong()).isEqualTo(2);
        assertThat(profile.get("activity").get("comments").asLong()).isEqualTo(1);
        // Likes RECEIVED on her videos, not likes she gave.
        assertThat(profile.get("activity").get("likesReceived").asLong()).isEqualTo(2);
    }

    @Test
    void anUnknownProfileIs404() throws Exception {
        mvc.perform(get("/api/users/{id}/profile", UUID.randomUUID()))
                .andExpect(status().isNotFound());
    }

    // --- editing --------------------------------------------------------------------

    @Test
    void editingUpdatesTheDisplayFieldsAndTheChangePersists() throws Exception {
        patchProfile(alice, "{\"displayName\":\"Alice A.\",\"bio\":\"I cut clips.\"}")
                .andExpect(status().isOk());

        JsonNode profile = json.readTree(okBody(get("/api/users/{id}/profile", alice.getId())));
        assertThat(profile.get("displayName").asText()).isEqualTo("Alice A.");
        assertThat(profile.get("bio").asText()).isEqualTo("I cut clips.");
    }

    /**
     * The PATCH contract: a field the client did not send is a field it has no opinion about.
     * This used to wipe the bio, because absent and blank were treated as the same thing.
     */
    @Test
    void omittingTheBioLeavesItAloneRatherThanWipingIt() throws Exception {
        patchProfile(alice, "{\"displayName\":\"Alice\",\"bio\":\"keep me\"}");

        patchProfile(alice, "{\"displayName\":\"Alice A.\"}").andExpect(status().isOk());

        JsonNode profile = json.readTree(okBody(get("/api/users/{id}/profile", alice.getId())));
        assertThat(profile.get("bio").asText()).isEqualTo("keep me");
        assertThat(profile.get("displayName").asText()).isEqualTo("Alice A.");
    }

    @Test
    void aBlankBioClearsItRatherThanLeavingTheOldOne() throws Exception {
        patchProfile(alice, "{\"displayName\":\"Alice\",\"bio\":\"something\"}");

        patchProfile(alice, "{\"displayName\":\"Alice\",\"bio\":\"\"}").andExpect(status().isOk());

        assertThat(json.readTree(okBody(get("/api/users/{id}/profile", alice.getId())))
                        .get("bio").isNull())
                .isTrue();
    }

    @Test
    void editingCannotChangeUsernameOrReachEmail() throws Exception {
        // Unknown properties are ignored rather than applied — the record has no such fields.
        patchProfile(alice, "{\"displayName\":\"Alice\",\"username\":\"stolen\","
                        + "\"email\":\"attacker@example.com\"}")
                .andExpect(status().isOk());

        JsonNode profile = json.readTree(okBody(get("/api/users/{id}/profile", alice.getId())));
        assertThat(profile.get("username").asText()).isEqualTo("alice");
        String storedEmail = jdbc.queryForObject(
                "select email from users where id = ?", String.class, alice.getId());
        assertThat(storedEmail).isEqualTo("alice@example.com");
    }

    // --- validation errors, per field ------------------------------------------------

    @Test
    void aBlankDisplayNameIs400WithTheErrorAttachedToThatField() throws Exception {
        String body = mvc.perform(patch("/api/users/{id}", alice.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        JsonNode problem = json.readTree(body);
        // Keyed by field, so a form can mark the input rather than print a sentence above it.
        assertThat(problem.get("errors").get("displayName").asText())
                .isEqualTo("Display name cannot be empty");
        assertThat(problem.get("detail").asText()).isNotBlank();
    }

    @Test
    void eachBrokenFieldGetsItsOwnMessage() throws Exception {
        String body = mvc.perform(patch("/api/users/{id}", alice.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"" + "x".repeat(200) + "\",\"bio\":\""
                                + "y".repeat(600) + "\"}"))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        JsonNode errors = json.readTree(body).get("errors");
        assertThat(errors.get("displayName").asText()).contains("100 characters");
        assertThat(errors.get("bio").asText()).contains("500 characters");
    }

    @Test
    void anAvatarUrlIsRejectedBecauseTheColumnHoldsRelativePathsOnly() throws Exception {
        String body = mvc.perform(patch("/api/users/{id}", alice.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Alice\","
                                + "\"avatarPath\":\"https://evil.example.com/a.png\"}"))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        assertThat(json.readTree(body).get("errors").get("avatarPath").asText())
                .contains("relative path");
    }

    /**
     * "Relative" used to mean only "no scheme and no leading slash", so a traversal segment
     * passed the DTO pattern, the service check and the database CHECK alike, and was then
     * composed into a URL.
     */
    @Test
    void anAvatarPathThatClimbsOutOfTheMediaDirectoryIsRejected() throws Exception {
        String body = mvc.perform(patch("/api/users/{id}", alice.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Alice\","
                                + "\"avatarPath\":\"../../../../etc/passwd\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andReturn().getResponse().getContentAsString();

        assertThat(json.readTree(body).get("detail").asText()).contains("..");
    }

    // --- avatar upload, validated on the server ---------------------------------------

    @Test
    void aRealPngIsAcceptedAndBecomesTheAvatarUrl() throws Exception {
        String path = uploadAvatar("me.png", "image/png", PNG_HEADER, 4_000);

        assertThat(path).startsWith("avatars/").endsWith(".png");
        patchProfile(alice, "{\"displayName\":\"Alice\",\"avatarPath\":\"" + path + "\"}")
                .andExpect(status().isOk());

        JsonNode profile = json.readTree(okBody(get("/api/users/{id}/profile", alice.getId())));
        // Stored relative, served absolute.
        assertThat(profile.get("avatarUrl").asText()).startsWith("http").endsWith(path);
        String stored = jdbc.queryForObject(
                "select avatar_path from users where id = ?", String.class, alice.getId());
        assertThat(stored).isEqualTo(path);
    }

    @Test
    void aJpegIsAcceptedToo() throws Exception {
        assertThat(uploadAvatar("me.jpg", "image/jpeg", JPEG_HEADER, 2_000)).endsWith(".jpg");
    }

    @Test
    void aWebPIsAcceptedToo() throws Exception {
        // The only format whose check reads all 12 sniffed bytes and compares at an offset.
        assertThat(uploadAvatar("me.webp", "image/webp", WEBP_HEADER, 500))
                .startsWith("avatars/")
                .endsWith(".webp");
    }

    /**
     * An SVG is an image by MIME prefix and a script container in practice. It used to fall
     * through to the extension fallback and be stored as .jpg — served, by default, from the
     * API's own origin.
     */
    @Test
    void anSvgIsRejectedRatherThanStoredUnderAnotherExtension() throws Exception {
        assertThat(uploadAvatarExpectingRejection(
                        "x.svg", "image/svg+xml", "<svg/>".getBytes(StandardCharsets.UTF_8), 0))
                .contains("image/svg+xml");
    }

    /** Omitting the header used to skip validation entirely and take the fallback extension. */
    @Test
    void anUploadWithNoContentTypeIsRejected() throws Exception {
        String detail = detailOf(mvc.perform(multipart("/api/media")
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .file(new MockMultipartFile("file", "x.png", null, PNG_HEADER))
                        .param("kind", "avatar"))
                .andExpect(status().isUnprocessableEntity()));

        assertThat(detail).contains("no content type");
    }

    @Test
    void aDeclaredContentTypeThatIsNotAnImageIsRejected() throws Exception {
        // The message names the type that was actually sent, so the caller can see what to fix.
        assertThat(uploadAvatarExpectingRejection(
                        "clip.mp4", "video/mp4", new byte[] {0, 0, 0, 24}, 1_000))
                .contains("image/")
                .contains("video/mp4");
    }

    /**
     * The one that matters for "validated on the server, not just the client": the request
     * claims image/png and the client would have been happy, but the bytes are not an image.
     * A check that trusted the declared type would store this.
     */
    @Test
    void bytesThatAreNotAnImageAreRejectedEvenWhenTheTypeClaimsOtherwise() throws Exception {
        byte[] notAnImage = "#!/bin/sh\nrm -rf /\n".getBytes(StandardCharsets.UTF_8);

        assertThat(uploadAvatarExpectingRejection("evil.png", "image/png", notAnImage, 0))
                .contains("the uploaded bytes are not one");
    }

    @Test
    void anImageOverTheAvatarSizeLimitIsRejected() throws Exception {
        // Well past 512KB, and a valid PNG header, so only the size can be what rejects it.
        // On the number, not on the word: "limit" alone cannot tell the 512KB avatar cap
        // from the 256MB media cap, which is the only thing this test is for.
        assertThat(uploadAvatarExpectingRejection("big.png", "image/png", PNG_HEADER, 900_000))
                .contains("524288");
    }

    @Test
    void anUnknownKindIsRejected() throws Exception {
        mvc.perform(multipart("/api/media")
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .file(new MockMultipartFile("file", "x.png", "image/png", PNG_HEADER))
                        .param("kind", "profile-banner"))
                .andExpect(status().isUnprocessableEntity());
    }

    // --- helpers -----------------------------------------------------------------------

    private ResultActions patchProfile(UserEntity user, String body) throws Exception {
        return mvc.perform(patch("/api/users/{id}", user.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private String uploadAvatar(String name, String type, byte[] header, int padding)
            throws Exception {
        String body = mvc.perform(multipart("/api/media")
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .file(new MockMultipartFile("file", name, type, bytes(header, padding)))
                        .param("kind", "avatar"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("path").asText();
    }

    /** @return the ProblemDetail's detail, so the caller can assert on the reason. */
    private String uploadAvatarExpectingRejection(String name, String type, byte[] header,
                                                  int padding) throws Exception {
        String body = mvc.perform(multipart("/api/media")
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .file(new MockMultipartFile("file", name, type, bytes(header, padding)))
                        .param("kind", "avatar"))
                .andExpect(status().isUnprocessableEntity())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("detail").asText();
    }

    private byte[] bytes(byte[] header, int padding) {
        byte[] out = new byte[header.length + padding];
        System.arraycopy(header, 0, out, 0, header.length);
        return out;
    }


}
