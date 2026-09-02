package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.UserEntity;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;

/**
 * Signing up, signing in, and what a token does and does not open.
 *
 * <p>The point of the last few is that identity is no longer something a request can assert:
 * the body and the query string have no field for it, so the only way to act as someone is
 * to hold their token.
 */
class AuthIntegrationTest extends ApiIntegrationTest {

    @Test
    void signingUpReturnsATokenAndTheNewUser() throws Exception {
        JsonNode body = json.readTree(signup("marko", "marko@example.com", "lozinka123")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());

        assertThat(body.get("token").asText()).isNotBlank();
        assertThat(body.get("user").get("username").asText()).isEqualTo("marko");
        // The display name starts as the username; the profile screen edits it afterwards.
        assertThat(body.get("user").get("displayName").asText()).isEqualTo("marko");
    }

    @Test
    void theStoredPasswordIsAHashAndNeverThePasswordItself() throws Exception {
        signup("marko", "marko@example.com", "lozinka123").andExpect(status().isCreated());

        String stored = jdbc.queryForObject(
                "select password_hash from users where username = 'marko'", String.class);
        assertThat(stored).isNotNull().doesNotContain("lozinka123").startsWith("$2");
    }

    @Test
    void anAlreadyRegisteredEmailIs409() throws Exception {
        signup("marko", "marko@example.com", "lozinka123").andExpect(status().isCreated());

        ResultActions second = signup("drugi", "marko@example.com", "lozinka123")
                .andExpect(status().isConflict());
        assertThat(detailOf(second)).contains("already registered");
    }

    @Test
    void anAlreadyTakenUsernameIs409() throws Exception {
        signup("marko", "marko@example.com", "lozinka123").andExpect(status().isCreated());

        signup("marko", "drugi@example.com", "lozinka123").andExpect(status().isConflict());
    }

    @Test
    void aShortPasswordIsRefused() throws Exception {
        signup("marko", "marko@example.com", "kratka").andExpect(status().isBadRequest());
    }

    @Test
    void signingInWithTheRightPasswordReturnsAWorkingToken() throws Exception {
        signup("marko", "marko@example.com", "lozinka123").andExpect(status().isCreated());

        JsonNode body = json.readTree(login("marko@example.com", "lozinka123")
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        // The token is not merely well-formed — it opens an endpoint that requires one.
        mvc.perform(get("/api/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + body.get("token").asText()))
                .andExpect(status().isOk());
    }

    @Test
    void theEmailIsMatchedWithoutRegardToCase() throws Exception {
        // The unique index is on lower(email), so an account registered in one case must be
        // reachable in another — otherwise a user can be locked out of their own account.
        signup("marko", "Marko@Example.com", "lozinka123").andExpect(status().isCreated());

        login("marko@example.com", "lozinka123").andExpect(status().isOk());
    }

    @Test
    void aWrongPasswordAndAnUnknownEmailAnswerIdentically() throws Exception {
        signup("marko", "marko@example.com", "lozinka123").andExpect(status().isCreated());

        String wrongPassword = detailOf(
                login("marko@example.com", "pogresna123").andExpect(status().isUnauthorized()));
        String unknownEmail = detailOf(
                login("niko@example.com", "lozinka123").andExpect(status().isUnauthorized()));

        // Identical on purpose: telling them apart turns the login form into a way to
        // discover which addresses have accounts.
        assertThat(wrongPassword).isEqualTo(unknownEmail);
    }

    @Test
    void meIsRefusedWithoutATokenAndCarriesNoCredential() throws Exception {
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());

        UserEntity alice = user("alice");
        JsonNode me = okJson(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(alice)));
        assertThat(me.get("id").asText()).isEqualTo(alice.getId().toString());
        assertThat(me.has("email")).isFalse();
        assertThat(me.has("passwordHash")).isFalse();
    }

    @Test
    void readingIsPublicButWritingIsNot() throws Exception {
        mvc.perform(get("/api/videos/feed")).andExpect(status().isOk());

        mvc.perform(post("/api/videos")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"x","durationSeconds":10,"manifestPath":"a/b.mp4"}"""))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aProfileMayOnlyBeEditedByItsOwner() throws Exception {
        UserEntity alice = user("alice");
        UserEntity bob = user("bob");

        mvc.perform(patch("/api/users/{id}", alice.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(bob))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Hijacked"}"""))
                .andExpect(status().isForbidden());

        mvc.perform(patch("/api/users/{id}", alice.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(alice))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Alisa"}"""))
                .andExpect(status().isOk());
    }

    // --- helpers ---------------------------------------------------------------------

    private ResultActions signup(String username, String email, String password) throws Exception {
        return mvc.perform(post("/api/auth/signup")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(
                        new SignupBody(username, email, password))));
    }

    private ResultActions login(String email, String password) throws Exception {
        return mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(new LoginBody(email, password))));
    }

    private record SignupBody(String username, String email, String password) {
    }

    private record LoginBody(String email, String password) {
    }
}
