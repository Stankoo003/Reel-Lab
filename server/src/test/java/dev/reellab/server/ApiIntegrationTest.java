package dev.reellab.server;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.entity.VideoEntity;
import dev.reellab.server.persistence.repository.CommentRepository;
import dev.reellab.server.persistence.repository.UserRepository;
import dev.reellab.server.persistence.repository.VideoLikeRepository;
import dev.reellab.server.persistence.repository.VideoRepository;
import dev.reellab.server.service.TokenService;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Shared scaffolding for the API integration tests.
 *
 * <p>The annotations below are also the Spring test-context cache key. Declared once, they
 * cannot be forked by accident: four copies meant that adding a property source to three of
 * them would silently start a second context and a second Postgres container, with nothing
 * saying so.
 *
 * <p>The reset is here for a sharper reason. It existed in four hand-maintained copies that had
 * already drifted into two different truncate lists, two of which worked only because CASCADE
 * happened to reach a table they forgot to name.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
public abstract class ApiIntegrationTest {

    /**
     * Uploads land here instead of the repository's own media/ directory.
     *
     * <p>The suite goes to the trouble of a throwaway database per build and then used to write
     * avatars into the developer's working tree, where nothing ever deleted them.
     */
    @TempDir
    static Path mediaDirectory;

    /**
     * A fixed test key. The application deliberately has no default — see application.yml —
     * so without this the context would not start.
     */
    private static final String TEST_SECRET = "test-signing-key-that-is-long-enough-for-hs256";

    @DynamicPropertySource
    static void testProperties(DynamicPropertyRegistry registry) {
        registry.add("reellab.media.storage.directory", () -> mediaDirectory.toString());
        registry.add("reellab.auth.secret", () -> TEST_SECRET);
    }

    // Local rather than autowired: these tests read responses as trees, and building the
    // mapper here keeps them independent of how the application configures its own.
    protected final JsonMapper json = JsonMapper.builder().build();

    @Autowired protected MockMvc mvc;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected UserRepository users;
    @Autowired protected VideoRepository videos;
    @Autowired protected CommentRepository comments;
    @Autowired protected VideoLikeRepository likes;
    @Autowired protected TokenService tokens;

    /** The container is shared across classes, so each test starts from known-empty tables. */
    @BeforeEach
    void truncateEverything() {
        jdbc.execute("truncate table video_likes, comments, videos, users cascade");
    }

    /**
     * The Authorization header value that makes a request act as this user.
     *
     * <p>A real token from the real encoder, not a mocked principal: it exercises the same
     * filter chain production does, so a change that breaks token verification fails here
     * rather than on a device.
     */
    protected String bearer(UserEntity user) {
        return "Bearer " + tokens.issue(user);
    }

    protected UserEntity user(String username) {
        return users.save(new UserEntity(username, username + "@example.com",
                Character.toUpperCase(username.charAt(0)) + username.substring(1),
                // Never used to sign in — these tests authenticate with bearer() above. It
                // only satisfies the not-null column.
                "$2a$10$notarealhashnotarealhashnotarealhashnotarealhashnotare"));
    }

    protected VideoEntity publishedVideo(UserEntity owner, String title) {
        VideoEntity video = new VideoEntity(
                owner, title, null, 30, UUID.randomUUID() + "/master.m3u8", null);
        video.setPublished(true);
        return videos.save(video);
    }

    /** Performs the request, asserts 200, and parses the body. */
    protected JsonNode okJson(RequestBuilder request) throws Exception {
        return json.readTree(okBody(request));
    }

    protected String okBody(RequestBuilder request) throws Exception {
        return mvc.perform(request).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /**
     * The {@code detail} of a ProblemDetail response whose status the caller has already
     * asserted — so one helper serves 400, 409, 415 and 422 alike.
     */
    protected String detailOf(ResultActions actions) throws Exception {
        String body = actions.andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("detail").asText();
    }

    /**
     * Follows nextCursor to exhaustion, collecting one field from every item.
     *
     * @param page fetches one page given (cursor, limit)
     * @param field the item field to collect, e.g. "title" or "body"
     */
    protected PagedWalk walkPages(PageFetcher page, String field, int limit) throws Exception {
        List<String> seen = new ArrayList<>();
        String cursor = null;
        int pages = 0;
        do {
            JsonNode body = page.fetch(cursor, limit);
            body.get("items").forEach(item -> seen.add(item.get(field).asText()));
            cursor = body.get("hasNext").asBoolean() ? body.get("nextCursor").asText() : null;
            pages++;
        } while (cursor != null);
        return new PagedWalk(seen, pages);
    }

    protected interface PageFetcher {
        JsonNode fetch(String cursor, int limit) throws Exception;
    }

    /** Everything a cursor walk saw, and how many requests it took. */
    protected record PagedWalk(List<String> values, int pages) {
    }
}
