package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.service.AuthService;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;

/** Changing the password from inside the app, as opposed to resetting it from a link. */
class PasswordChangeIntegrationTest extends ApiIntegrationTest {

    @Autowired PasswordEncoder encoder;

    private UserEntity alice;

    @BeforeEach
    void seed() {
        alice = users.save(new UserEntity("alice", "alice@example.com", "Alice",
                encoder.encode("originalpassword")));
    }

    private ResultActions change(String bearer, String current, String next) throws Exception {
        var request = post("/api/auth/password/change")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(
                        Map.of("currentPassword", current, "newPassword", next)));
        if (bearer != null) {
            request = request.header(HttpHeaders.AUTHORIZATION, bearer);
        }
        return mvc.perform(request);
    }

    private boolean canSignIn(String password) throws Exception {
        return mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(
                                Map.of("email", "alice@example.com", "password", password))))
                .andReturn().getResponse().getStatus() == 200;
    }

    /**
     * The whole contract in one pass: the new password works, the old one does not, the
     * token that made the change is retired, and the one handed back is good.
     */
    @Test
    void changingThePasswordSwapsTheCredentialAndTheToken() throws Exception {
        String before = bearer(alice);

        JsonNode body = json.readTree(change(before, "originalpassword", "brandnewpassword")
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(canSignIn("brandnewpassword")).isTrue();
        assertThat(canSignIn("originalpassword")).isFalse();

        // The old token is from before the change — every other device is signed out, and
        // so would this one be, if it kept it.
        mvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, before))
                .andExpect(status().isUnauthorized());
        // The fresh one is what keeps this device signed in.
        mvc.perform(get("/api/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + body.get("token").asText()))
                .andExpect(status().isOk());
    }

    /** A valid token is not enough: an unlocked phone must not be able to lock you out. */
    @Test
    void theCurrentPasswordIsRequiredAndChecked() throws Exception {
        ResultActions wrong = change(bearer(alice), "notmypassword", "brandnewpassword");
        wrong.andExpect(status().isUnauthorized());
        assertThat(detailOf(wrong)).isEqualTo(AuthService.WRONG_CURRENT_PASSWORD);
        assertThat(canSignIn("originalpassword")).isTrue();

        change(null, "originalpassword", "brandnewpassword").andExpect(status().isUnauthorized());
    }

    @Test
    void theNewPasswordIsHeldToTheSignUpRule() throws Exception {
        change(bearer(alice), "originalpassword", "short").andExpect(status().isUnprocessableEntity());
        ResultActions same = change(bearer(alice), "originalpassword", "originalpassword");
        same.andExpect(status().isUnprocessableEntity());
        assertThat(detailOf(same)).isEqualTo(AuthService.SAME_PASSWORD);
        change(bearer(alice), "originalpassword", "").andExpect(status().isBadRequest());
        assertThat(canSignIn("originalpassword")).isTrue();
    }
}
