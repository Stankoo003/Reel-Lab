package dev.reellab.server.service.mail;

import dev.reellab.server.config.MailProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import tools.jackson.databind.json.JsonMapper;

/**
 * Resend, for the deployed environment.
 *
 * <p>HTTPS rather than SMTP: no port 587 to get past a host's egress rules, and no
 * connection to keep warm. One POST with a bearer key.
 *
 * <p>The JDK's own HttpClient rather than Spring's RestClient, for an architectural reason
 * that ArchUnit enforces: this class lives in the service layer, and RestClient lives in
 * {@code org.springframework.web} — which the layering rule forbids the service layer to
 * depend on. The rule is about not knowing HTTP-as-our-API; a client for somebody else's API
 * is different in spirit but identical to a package matcher, and the JDK client makes the
 * distinction moot rather than arguing with the rule.
 */
public class ResendMailer implements Mailer {

    private static final URI ENDPOINT = URI.create("https://api.resend.com/emails");
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final JsonMapper json = JsonMapper.builder().build();
    private final MailProperties properties;

    public ResendMailer(MailProperties properties) {
        this.properties = properties;
    }

    @Override
    public void send(String to, String subject, String text, String html) {
        String body = json.writeValueAsString(new Payload(
                properties.from(), new String[] {to}, subject, text, html));
        HttpRequest request = HttpRequest.newBuilder(ENDPOINT)
                .timeout(TIMEOUT)
                .header("Authorization", "Bearer " + properties.resendApiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        try {
            HttpResponse<String> response =
                    http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                // The body carries Resend's reason — an unverified sending domain, most
                // often — and losing it would make this the hardest kind of failure to
                // diagnose: silent mail.
                throw new IllegalStateException(
                        "Resend refused the message: " + response.statusCode() + " " + response.body());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while sending mail", e);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Could not reach Resend", e);
        }
    }

    @Override
    public String describe() {
        return "resend";
    }

    /** Resend's request shape. `to` is a list even for one recipient. */
    private record Payload(String from, String[] to, String subject, String text, String html) {
    }
}
