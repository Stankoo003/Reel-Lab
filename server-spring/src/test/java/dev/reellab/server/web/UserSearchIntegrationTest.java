package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.UserEntity;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** GET /api/users/search — finding other people on the app. */
class UserSearchIntegrationTest extends ApiIntegrationTest {

    @BeforeEach
    void seed() {
        user("mila");
        user("marko");
        user("aleksa");
    }

    /** The usernames a search returns, in the order it returned them. */
    private List<String> handles(String query) throws Exception {
        JsonNode body = okJson(get("/api/users/search").param("q", query));
        List<String> found = new ArrayList<>();
        body.forEach(row -> found.add(row.get("username").asText()));
        return found;
    }

    @Test
    void findsPeopleByHandle() throws Exception {
        assertThat(handles("mil")).containsExactly("mila");
    }

    @Test
    void findsPeopleByDisplayName() throws Exception {
        // The helper's display name is the capitalised username, so this only matches by
        // display name if the search is genuinely looking at that column too.
        UserEntity dara = user("qqq");
        dara.setDisplayName("Dara Petrovic");
        users.save(dara);

        assertThat(handles("petrovic")).containsExactly("qqq");
    }

    @Test
    void ignoresCase() throws Exception {
        assertThat(handles("MILA")).containsExactly("mila");
    }

    @Test
    void matchesInTheMiddleOfAName() throws Exception {
        assertThat(handles("eks")).containsExactly("aleksa");
    }

    /**
     * Someone typing "m" means both, and the one whose handle STARTS with it is the one they
     * are more likely to be after — see UserRepository.search for the ordering.
     */
    @Test
    void ranksHandlePrefixMatchesFirst() throws Exception {
        UserEntity late = user("zoran");
        late.setDisplayName("Milan Zoric");
        users.save(late);

        // mila and marko start with m; zoran only matches through its display name.
        assertThat(handles("m")).containsExactly("marko", "mila", "zoran");
    }

    /**
     * The one that matters for a live-as-you-type box: the first keystroke must not be
     * preceded by a request for the whole table.
     */
    @Test
    void anEmptyQueryReturnsNobodyRatherThanEveryone() throws Exception {
        assertThat(handles("")).isEmpty();
        assertThat(handles("   ")).isEmpty();
        assertThat(okJson(get("/api/users/search")).size()).isZero();
    }

    /** Handles are written with an @ everywhere in the app; pasting one in must still work. */
    @Test
    void aLeadingAtIsPartOfHowHandlesAreWrittenNotPartOfTheName() throws Exception {
        assertThat(handles("@mila")).containsExactly("mila");
    }

    /**
     * LIKE gives % and _ meaning. Unescaped, "%" alone is a request for every account on the
     * server — the exact query a bored user types first.
     */
    @Test
    void wildcardCharactersAreSearchedForLiterallyRatherThanInterpreted() throws Exception {
        assertThat(handles("%")).isEmpty();
        // _ matches any single character in LIKE, so unescaped this would return mila.
        assertThat(handles("mil_")).isEmpty();

        UserEntity odd = user("save50");
        odd.setDisplayName("50% off");
        users.save(odd);
        assertThat(handles("50%")).containsExactly("save50");
    }

    @Test
    void aSearchNobodyMatchesIsAnEmptyListNotAnError() throws Exception {
        assertThat(handles("nobodyhere")).isEmpty();
    }

    @Test
    void limitCapsTheResults() throws Exception {
        assertThat(okJson(get("/api/users/search").param("q", "a").param("limit", "1")).size())
                .isEqualTo(1);
    }

    /**
     * The same rule the rest of the API lives by, applied to the newest endpoint that returns
     * users: a result row carries what a list draws and nothing that identifies the account.
     */
    @Test
    void resultsCarryNoEmailAndNoCredential() throws Exception {
        String body = okBody(get("/api/users/search").param("q", "mila"));

        assertThat(body).as("the row must actually be there").contains("mila");
        assertThat(body.toLowerCase())
                .doesNotContain("@example.com")
                .doesNotContain("\"email\"")
                .doesNotContain("passwordhash")
                .doesNotContain("\"password\"");
    }

    /** Reading is open here, as it is for the feed and for a profile. */
    @Test
    void searchingNeedsNoToken() throws Exception {
        assertThat(handles("mila")).containsExactly("mila");
    }
}
