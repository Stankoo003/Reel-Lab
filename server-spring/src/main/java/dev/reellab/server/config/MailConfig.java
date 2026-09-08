package dev.reellab.server.config;

import dev.reellab.server.service.mail.Mailer;
import dev.reellab.server.service.mail.ResendMailer;
import dev.reellab.server.service.mail.SmtpMailer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;

/**
 * Which mailer is in the context.
 *
 * <p>One bean, chosen once at startup from {@code reellab.mail.provider}. Everything that
 * sends mail depends on the {@link Mailer} interface and cannot tell which it got — that is
 * what makes "Mailpit locally, Resend deployed" a configuration difference rather than a
 * branch in the code that sends.
 */
@Configuration
public class MailConfig {

    @Bean
    Mailer mailer(MailProperties properties, JavaMailSender smtp) {
        return properties.isResend()
                ? new ResendMailer(properties)
                : new SmtpMailer(smtp, properties);
    }
}
