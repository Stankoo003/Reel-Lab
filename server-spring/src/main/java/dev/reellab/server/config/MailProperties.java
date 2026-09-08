package dev.reellab.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param provider {@code smtp} (Mailpit locally, or any SMTP server) or {@code resend}
 * @param from the envelope sender, e.g. {@code ReelLab <no-reply@reellab.dev>}. Resend
 *     refuses anything on a domain you have not verified, which is the usual first failure
 *     when deploying this.
 * @param resendApiKey only read when the provider is {@code resend}
 * @param webBaseUrl where the reset LINK points — the server's own public URL, not the app's
 *     scheme. See PasswordResetController for why the link is https and not reellab://
 */
@ConfigurationProperties("reellab.mail")
public record MailProperties(String provider, String from, String resendApiKey,
                             String webBaseUrl) {

    public boolean isResend() {
        return "resend".equalsIgnoreCase(provider);
    }
}
