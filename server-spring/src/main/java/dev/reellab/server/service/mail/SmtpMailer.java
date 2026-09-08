package dev.reellab.server.service.mail;

import dev.reellab.server.config.MailProperties;
import jakarta.mail.internet.MimeMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

/**
 * SMTP — Mailpit in local development, and any SMTP relay in a deployment that prefers one.
 *
 * <p>Mailpit accepts everything and delivers nothing: it is a mailbox with a web UI on
 * :8025, so a reset email can be read and its link clicked without a real address, a real
 * domain, or the risk of mailing a stranger from a test run.
 */
public class SmtpMailer implements Mailer {

    private final JavaMailSender sender;
    private final MailProperties properties;

    public SmtpMailer(JavaMailSender sender, MailProperties properties) {
        this.sender = sender;
        this.properties = properties;
    }

    @Override
    public void send(String to, String subject, String text, String html) {
        try {
            MimeMessage message = sender.createMimeMessage();
            // true: multipart/alternative — the client picks the body it can render.
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(properties.from());
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(text, html);
            sender.send(message);
        } catch (Exception e) {
            // Wrapped rather than swallowed: the caller sends on a background thread and
            // logs it there, because a failure to send must not become a failure of the
            // request — which would tell the sender whether the address exists.
            throw new IllegalStateException("SMTP send failed", e);
        }
    }

    @Override
    public String describe() {
        return "smtp";
    }
}
