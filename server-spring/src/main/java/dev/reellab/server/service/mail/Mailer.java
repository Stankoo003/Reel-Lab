package dev.reellab.server.service.mail;

/**
 * Sending one email.
 *
 * <p>The whole point of this interface is that everything above it — the password reset, and
 * anything that sends mail later — never learns which provider is behind it. Locally that is
 * Mailpit over SMTP; deployed it is Resend over HTTPS. Switching is a line of configuration,
 * {@code reellab.mail.provider}, and no code.
 *
 * <p>Both a plain-text and an HTML body, always. Text-only mail looks like spam to filters
 * and to people; HTML-only mail is unreadable in the clients that refuse to render it, and
 * a reset link that cannot be read is a locked-out user.
 */
public interface Mailer {

    void send(String to, String subject, String text, String html);

    /** What this instance is actually sending through — for the health/info endpoints. */
    String describe();
}
