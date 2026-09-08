package dev.reellab.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.reellab.server.ApiIntegrationTest;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.service.PasswordResetService;
import dev.reellab.server.service.RequestRateLimiter;
import dev.reellab.server.service.mail.Mailer;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;

/**
 * Password reset, end to end.
 *
 * <p>The real Mailer is replaced by one that keeps what it was asked to send. That is the
 * only substitution: the token is generated, hashed and stored by the real service, and the
 * only way this test learns the token is the same way a user does — by reading the email.
 * A test that reached into the table for it would not be testing what a person can do.
 */
@TestPropertySource(properties = {
    // The endpoint deliberately takes a fixed time; 250ms per call would make this class
    // take longer than the rest of the suite. The behaviour under test is that both paths
    // take the SAME time, which holds at any floor.
    "reellab.password-reset.response-floor=30ms",
    "reellab.password-reset.ttl=45m",
    "reellab.password-reset.per-email-limit=3",
    "reellab.password-reset.per-ip-limit=10",
    "reellab.password-reset.window=15m",
})
class PasswordResetIntegrationTest extends ApiIntegrationTest {

    /** Stands in for Mailpit or Resend, and keeps what it was handed. */
    static class RecordingMailer implements Mailer {

        record Sent(String to, String subject, String text, String html) {
        }

        final List<Sent> sent = new CopyOnWriteArrayList<>();

        @Override
        public void send(String to, String subject, String text, String html) {
            sent.add(new Sent(to, subject, text, html));
        }

        @Override
        public String describe() {
            return "recording";
        }
    }

    @TestConfiguration
    static class Mail {
        @Bean
        @Primary
        RecordingMailer recordingMailer() {
            return new RecordingMailer();
        }
    }

    @Autowired RecordingMailer mailer;
    @Autowired RequestRateLimiter limiter;
    @Autowired PasswordEncoder encoder;

    private UserEntity alice;

    @BeforeEach
    void seed() {
        mailer.sent.clear();
        // The limiter is a singleton across the shared context, so one test's requests
        // would otherwise count against the next one's.
        limiter.clear();
        alice = users.save(new UserEntity("alice", "alice@example.com", "Alice",
                encoder.encode("originalpassword")));
    }

    // --- helpers ------------------------------------------------------------------

    private void requestReset(String email) throws Exception {
        mvc.perform(post("/api/auth/password/reset-request")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isOk());
    }

    /** The token as a recipient would get it: pulled out of the link in the email. */
    private String tokenFromLastEmail() {
        assertThat(mailer.sent).as("an email must have been sent").isNotEmpty();
        String body = mailer.sent.get(mailer.sent.size() - 1).text();
        int at = body.indexOf("?token=");
        assertThat(at).as("the email must carry a reset link").isGreaterThan(-1);
        String rest = body.substring(at + "?token=".length());
        return rest.split("\\s+")[0];
    }

    private ResultOf reset(String token, String password) throws Exception {
        var actions = mvc.perform(post("/api/auth/password/reset")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(
                        Map.of("token", token, "newPassword", password))));
        int status = actions.andReturn().getResponse().getStatus();
        String body = actions.andReturn().getResponse().getContentAsString();
        return new ResultOf(status, body);
    }

    private record ResultOf(int status, String body) {
        boolean ok() {
            return status == 200;
        }

        String detail() {
            return body.contains("\"detail\"")
                    ? body.split("\"detail\":\"")[1].split("\"")[0]
                    : body;
        }
    }

    private boolean canSignIn(String email, String password) throws Exception {
        return mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(
                                Map.of("email", email, "password", password))))
                .andReturn().getResponse().getStatus() == 200;
    }

    // --- the criteria -------------------------------------------------------------

    @Test
    void aResetEmailCarriesAWorkingLink() throws Exception {
        requestReset("alice@example.com");

        assertThat(mailer.sent).hasSize(1);
        RecordingMailer.Sent mail = mailer.sent.get(0);
        assertThat(mail.to()).isEqualTo("alice@example.com");
        // Both bodies, always — see Mailer.
        assertThat(mail.text()).contains("/reset?token=");
        assertThat(mail.html()).contains("/reset?token=");
        assertThat(mail.text()).as("says how long it lasts").contains("45 minutes");
    }

    @Test
    void aValidTokenChangesThePasswordExactlyOnce() throws Exception {
        requestReset("alice@example.com");
        String token = tokenFromLastEmail();

        assertThat(reset(token, "brandnewpassword").ok()).isTrue();
        assertThat(canSignIn("alice@example.com", "brandnewpassword")).isTrue();
        assertThat(canSignIn("alice@example.com", "originalpassword")).isFalse();

        // The same link again, which is what a double-click or a forwarded email produces.
        ResultOf second = reset(token, "thirdpassword");
        assertThat(second.ok()).isFalse();
        assertThat(second.detail()).isEqualTo(PasswordResetService.INVALID_TOKEN);
        assertThat(canSignIn("alice@example.com", "thirdpassword")).isFalse();
    }

    @Test
    void anExpiredTokenIsRejectedWithItsOwnMessage() throws Exception {
        requestReset("alice@example.com");
        String token = tokenFromLastEmail();

        // Aged in the database rather than by waiting 45 minutes. The row is the only thing
        // that knows when it expires, so moving it is the whole of "time passed".
        jdbc.update("update password_resets set expires_at = ? where consumed_at is null",
                java.sql.Timestamp.from(Instant.now().minus(Duration.ofMinutes(1))));

        ResultOf result = reset(token, "brandnewpassword");
        assertThat(result.ok()).isFalse();
        // Distinct from INVALID: the link was real and they were merely late, which is
        // advice rather than a shrug.
        assertThat(result.detail()).isEqualTo(PasswordResetService.EXPIRED_TOKEN);
        assertThat(canSignIn("alice@example.com", "originalpassword")).isTrue();
    }

    @Test
    void askingAgainInvalidatesTheLinkAlreadySent() throws Exception {
        requestReset("alice@example.com");
        String first = tokenFromLastEmail();

        requestReset("alice@example.com");
        String second = tokenFromLastEmail();
        assertThat(second).isNotEqualTo(first);

        assertThat(reset(first, "brandnewpassword").detail())
                .isEqualTo(PasswordResetService.INVALID_TOKEN);
        assertThat(reset(second, "brandnewpassword").ok()).isTrue();
    }

    /**
     * The whole reason this endpoint is shaped the way it is. A different body, status or
     * duration for a registered address turns "forgot password" into a way to ask the server
     * which of a million addresses have accounts.
     */
    @Test
    void aRegisteredAndAnUnregisteredAddressAreIndistinguishable() throws Exception {
        var known = mvc.perform(post("/api/auth/password/reset-request")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"alice@example.com\"}")).andReturn().getResponse();
        var unknown = mvc.perform(post("/api/auth/password/reset-request")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"nobody@example.com\"}")).andReturn().getResponse();

        assertThat(unknown.getStatus()).isEqualTo(known.getStatus());
        assertThat(unknown.getContentAsString()).isEqualTo(known.getContentAsString());
        assertThat(known.getContentAsString()).contains(PasswordResetService.REQUEST_ACCEPTED);
        // And no email went to an address with no account.
        assertThat(mailer.sent).extracting(RecordingMailer.Sent::to)
                .containsExactly("alice@example.com");
    }

    /**
     * Timing, measured rather than assumed.
     *
     * <p>The floor is what makes this hold: finding a user, retiring old tokens and inserting
     * a row is work the unknown address does not do, and that difference is visible from
     * outside over enough samples. Medians are compared, not single calls, because a single
     * call on a busy machine measures the machine.
     */
    @Test
    void bothPathsTakeTheSameTimeToAnswer() throws Exception {
        // Warm: the first call through any path pays for class loading and a statement cache.
        requestReset("warmup@example.com");
        limiter.clear();

        List<Long> knownTimes = new ArrayList<>();
        List<Long> unknownTimes = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            knownTimes.add(timeOf("alice@example.com"));
            unknownTimes.add(timeOf("nobody" + i + "@example.com"));
            // The per-email limit is 3, and this asks for far more than that.
            limiter.clear();
        }

        long known = median(knownTimes);
        long unknown = median(unknownTimes);
        long difference = Math.abs(known - unknown);
        assertThat(difference)
                .as("median %dms known vs %dms unknown", known, unknown)
                // Generous, because this runs on whatever CI machine is free. The point is
                // that the difference is noise around a constant floor rather than the
                // milliseconds of real work one path does and the other does not.
                .isLessThan(25);
    }

    private long timeOf(String email) throws Exception {
        long start = System.nanoTime();
        requestReset(email);
        return (System.nanoTime() - start) / 1_000_000;
    }

    private static long median(List<Long> values) {
        List<Long> sorted = new ArrayList<>(values);
        sorted.sort(Long::compareTo);
        return sorted.get(sorted.size() / 2);
    }

    /** The property the whole table design rests on, checked against the table itself. */
    @Test
    void theTableHoldsHashesAndNeverTheTokenItself() throws Exception {
        requestReset("alice@example.com");
        String token = tokenFromLastEmail();

        List<Map<String, Object>> rows = jdbc.queryForList("select * from password_resets");
        assertThat(rows).hasSize(1);

        String stored = (String) rows.get(0).get("token_hash");
        assertThat(stored).isEqualTo(PasswordResetService.sha256(token));
        assertThat(stored).hasSize(64).matches("[0-9a-f]{64}");

        // Not merely "the hash column is a hash" — no column anywhere in the row holds the
        // token, in any form. A helpful extra column added later fails here.
        assertThat(rows.get(0).values().stream().map(String::valueOf))
                .as("no column may contain the token")
                .noneMatch(value -> value.contains(token));
    }

    @Test
    void repeatedRequestsForOneAddressAreRefused() throws Exception {
        for (int i = 0; i < 3; i++) {
            requestReset("alice@example.com");
        }
        // The fourth, inside the window.
        mvc.perform(post("/api/auth/password/reset-request")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"alice@example.com\"}"))
                .andExpect(status().isTooManyRequests());

        // And nothing more was mailed — the limit protects the inbox, not just the server.
        assertThat(mailer.sent).hasSize(3);
    }

    /**
     * The second limit: one host, many addresses.
     *
     * <p>The per-email limit protects one person's inbox. This one protects everyone else's:
     * without it, a single machine could walk a list of addresses three requests at a time
     * and stay under every per-email counter. Different addresses on purpose, so the email
     * limit cannot be what refuses the last one.
     */
    @Test
    void oneHostCannotWalkAListOfAddresses() throws Exception {
        String host = "203.0.113.7";
        for (int i = 0; i < 10; i++) {
            mvc.perform(post("/api/auth/password/reset-request")
                            .header("X-Forwarded-For", host)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"email\":\"person" + i + "@example.com\"}"))
                    .andExpect(status().isOk());
        }
        mvc.perform(post("/api/auth/password/reset-request")
                        .header("X-Forwarded-For", host)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"person10@example.com\"}"))
                .andExpect(status().isTooManyRequests());

        // Per host, not global: somebody else's reset must not be collateral damage.
        mvc.perform(post("/api/auth/password/reset-request")
                        .header("X-Forwarded-For", "198.51.100.4")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"alice@example.com\"}"))
                .andExpect(status().isOk());
    }

    /**
     * Recovering an account you believe someone else is inside has to throw them out, or it
     * is not recovery. Sessions are stateless JWTs, so this is the one place that shows the
     * invalidation actually works.
     */
    @Test
    void changingThePasswordInvalidatesSessionsThatAlreadyExist() throws Exception {
        String sessionFromBefore = bearer(alice);
        mvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, sessionFromBefore))
                .andExpect(status().isOk());

        requestReset("alice@example.com");
        // No sleep, deliberately. The rule compares an exact stamp rather than ordering a
        // one-second `iat` against a microsecond instant, so a session created milliseconds
        // before the reset dies exactly as one created an hour before does — see
        // TokenService.PASSWORD_CLAIM.
        assertThat(reset(tokenFromLastEmail(), "brandnewpassword").ok()).isTrue();

        mvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, sessionFromBefore))
                .andExpect(status().isUnauthorized());

        // The new sign-in works, so this invalidated the old session rather than the account.
        assertThat(canSignIn("alice@example.com", "brandnewpassword")).isTrue();
    }

    // --- the web fallback ---------------------------------------------------------

    @Test
    void theResetLinkOpensAPageThatWorksWithoutTheApp() throws Exception {
        String body = mvc.perform(get("/reset").param("token", "abc123"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("Choose a new password");
        // It can finish the reset itself...
        assertThat(body).contains("/api/auth/password/reset");
        // ...and it offers the app to whoever has it.
        assertThat(body).contains("reellab://reset-password?token=abc123");
    }

    @Test
    void thePageRefusesToBeAnInjectionPoint() throws Exception {
        String body = mvc.perform(get("/reset").param("token", "\"><script>alert(1)</script>"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("<script>alert(1)</script>");
        assertThat(body).contains("&lt;script&gt;");
    }

    @Test
    void aTooShortPasswordIsRefusedBeforeTheTokenIsSpent() throws Exception {
        requestReset("alice@example.com");
        String token = tokenFromLastEmail();

        assertThat(reset(token, "short").ok()).isFalse();
        // The token survives a rejected attempt — otherwise a typo would cost a link.
        assertThat(reset(token, "brandnewpassword").ok()).isTrue();
    }

    @Test
    void aTokenThatWasNeverIssuedIsRefused() throws Exception {
        ResultOf result = reset("not-a-real-token", "brandnewpassword");
        assertThat(result.ok()).isFalse();
        assertThat(result.detail()).isEqualTo(PasswordResetService.INVALID_TOKEN);
    }
}
