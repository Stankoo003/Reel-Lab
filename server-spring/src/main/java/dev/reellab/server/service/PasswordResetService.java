package dev.reellab.server.service;

import dev.reellab.server.config.MailProperties;
import dev.reellab.server.config.PasswordResetProperties;
import dev.reellab.server.persistence.entity.PasswordResetEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.repository.PasswordResetRepository;
import dev.reellab.server.persistence.repository.UserRepository;
import dev.reellab.server.service.exception.ValidationException;
import dev.reellab.server.service.mail.Mailer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.concurrent.Executor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Forgotten passwords.
 *
 * <p>Four rules hold this together, and each of them is a security property rather than a
 * convenience:
 *
 * <ol>
 *   <li>The stored row holds a HASH. A leaked database is not a set of working reset links.
 *   <li>Using a token consumes it, and a new request retires the old ones. There is never
 *       more than one live link per account, and never a link that works twice.
 *   <li>The request endpoint answers identically — same body, same status, same TIME — for
 *       an address that has an account and one that does not. Anything else turns "forgot
 *       password" into a way to ask the server which of a million addresses are registered.
 *   <li>Completing a reset moves the account's {@code passwordChangedAt}, which invalidates
 *       every token issued before it. Recovering an account you think is compromised has to
 *       throw the intruder out, or it is not recovery.
 * </ol>
 */
@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);

    /**
     * The one answer the request endpoint ever gives.
     *
     * <p>Worded so it is true either way: it does not say an email was sent, because for an
     * unregistered address none was.
     */
    public static final String REQUEST_ACCEPTED =
            "If that email has an account, a reset link is on its way.";

    public static final String INVALID_TOKEN =
            "That reset link is no longer valid. Ask for a new one.";

    public static final String EXPIRED_TOKEN =
            "That reset link has expired. Ask for a new one.";

    public static final String RATE_LIMITED =
            "Too many reset requests. Wait a few minutes and try again.";

    /** 256 bits from a CSPRNG — see the migration for why this needs no slow hash. */
    private static final int TOKEN_BYTES = 32;

    private final UserRepository users;
    private final PasswordResetRepository resets;
    private final PasswordEncoder encoder;
    private final Mailer mailer;
    private final RequestRateLimiter limiter;
    private final PasswordResetProperties config;
    private final MailProperties mail;
    private final Executor background;
    private final SecureRandom random = new SecureRandom();

    public PasswordResetService(UserRepository users, PasswordResetRepository resets,
                                PasswordEncoder encoder, Mailer mailer,
                                RequestRateLimiter limiter, PasswordResetProperties config,
                                MailProperties mail,
                                // Named: enabling @Scheduled also puts a taskScheduler in
                                // the context, and both are Executors.
                                @Qualifier("backgroundExecutor") Executor background) {
        this.users = users;
        this.resets = resets;
        this.encoder = encoder;
        this.mailer = mailer;
        this.limiter = limiter;
        this.config = config;
        this.mail = mail;
        this.background = background;
    }

    /**
     * Ask for a reset link.
     *
     * <p>Returns nothing, and throws only when rate limited. An unknown address is not an
     * error — it is the same non-event as a known one, and the caller cannot tell which
     * happened.
     */
    @Transactional
    public void request(String email, String clientIp) {
        long start = System.nanoTime();
        try {
            String key = email == null ? "" : email.trim().toLowerCase();
            // Both limits, and the email one first: it is the one that protects a person
            // from a flooded inbox, which is the abuse that actually reaches someone.
            boolean allowed =
                    limiter.tryAcquire("reset:email:" + key, config.perEmailLimit(), config.window())
                    & limiter.tryAcquire("reset:ip:" + clientIp, config.perIpLimit(), config.window());
            if (!allowed) {
                throw new TooManyRequestsException(RATE_LIMITED);
            }

            Optional<UserEntity> found = users.findByEmailIgnoreCase(key);
            if (found.isEmpty()) {
                // Nothing to do, and nothing to say. The floor in the finally block is what
                // makes this branch cost the same as the one below.
                log.debug("Password reset requested for an address with no account");
                return;
            }

            UserEntity user = found.get();
            Instant now = Instant.now();
            // Any link already in their inbox stops working now. Requesting a new one is
            // the action of somebody who does not have the old one — or who thinks it
            // leaked — and either way the old one has to die.
            resets.consumeOutstanding(user.getId(), now);

            String token = newToken();
            resets.save(new PasswordResetEntity(
                    user, sha256(token), now.plus(config.ttl()), clientIp));

            // Sent off the request thread. Mail takes as long as mail takes, and letting
            // that time into the response would undo the constant floor below — a real
            // send is measurably slower than no send at all.
            String to = user.getEmail();
            background.execute(() -> deliver(to, token));
        } finally {
            floorResponseTime(start);
        }
    }

    /**
     * Spend a token and set a new password.
     *
     * @return the user whose password changed
     */
    @Transactional
    public UserEntity reset(String token, String newPassword) {
        if (newPassword == null || newPassword.length() < AuthService.MIN_PASSWORD) {
            throw new ValidationException(
                    "Use at least " + AuthService.MIN_PASSWORD + " characters.");
        }
        if (token == null || token.isBlank()) {
            throw new ValidationException(INVALID_TOKEN);
        }

        PasswordResetEntity row = resets.findByTokenHash(sha256(token))
                // Unknown, already used, or replaced — all the same sentence. Telling them
                // apart would say whether a token ever existed.
                .orElseThrow(() -> new ValidationException(INVALID_TOKEN));

        Instant now = Instant.now();
        if (row.getConsumedAt() != null) {
            throw new ValidationException(INVALID_TOKEN);
        }
        // Expiry gets its OWN message. It is the one failure a person can act on differently:
        // the link was real and they were simply too late, so "ask for a new one" is advice
        // rather than a shrug.
        if (!row.getExpiresAt().isAfter(now)) {
            throw new ValidationException(EXPIRED_TOKEN);
        }

        UserEntity user = row.getUser();
        // The new hash and the invalidation instant together — see UserEntity.changePassword.
        user.changePassword(encoder.encode(newPassword), now);
        row.consume(now);
        // Belt and braces: any other outstanding row for this user dies here too, so a
        // second link mailed a moment before this one cannot still be walked in on.
        resets.consumeOutstanding(user.getId(), now);
        return user;
    }

    /**
     * Waits until a fixed budget has passed since {@code start}.
     *
     * <p>An endpoint that deliberately wastes time looks wrong until you see what it buys.
     * Finding a user, retiring old tokens and inserting a row are all work that an
     * unregistered address does not do — and the difference is measurable from outside, in
     * milliseconds, over enough samples. That difference IS the account-enumeration oracle
     * this endpoint exists to avoid. Answering after a constant makes both paths identical
     * by construction rather than by hoping the work happens to be similar.
     */
    private void floorResponseTime(long startNanos) {
        long remaining = config.responseFloor().toNanos() - (System.nanoTime() - startNanos);
        if (remaining <= 0) {
            return;
        }
        try {
            Thread.sleep(Duration.ofNanos(remaining));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void deliver(String to, String token) {
        String link = mail.webBaseUrl() + "/reset?token=" + token;
        try {
            mailer.send(to, "Reset your ReelLab password", plainBody(link), htmlBody(link));
        } catch (RuntimeException e) {
            // Logged, never rethrown to the caller: this runs after the response has already
            // gone out, and a send failure must not change what the requester saw.
            log.error("Could not send a password reset email", e);
        }
    }

    private String newToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        random.nextBytes(bytes);
        // URL-safe and unpadded: this travels in a query string and through mail clients
        // that would helpfully "fix" a + or a trailing =.
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Hex SHA-256, which is what the column stores and the only form ever compared. */
    public static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is required of every JVM; this cannot happen.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private String plainBody(String link) {
        return """
                Someone asked to reset the password on your ReelLab account.

                Open this link to choose a new one:
                %s

                The link works once and expires in %d minutes. If this was not you, you can
                ignore this email — nothing has changed, and your password still works.
                """.formatted(link, config.ttl().toMinutes());
    }

    private String htmlBody(String link) {
        return """
                <p>Someone asked to reset the password on your ReelLab account.</p>
                <p><a href="%s">Choose a new password</a></p>
                <p>The link works once and expires in %d minutes. If this was not you, you can
                ignore this email &mdash; nothing has changed, and your password still works.</p>
                <p style="color:#666;font-size:12px">%s</p>
                """.formatted(link, config.ttl().toMinutes(), link);
    }

    /** Rate limited. Its own type so the web layer answers 429 rather than 422. */
    public static class TooManyRequestsException extends RuntimeException {
        public TooManyRequestsException(String message) {
            super(message);
        }
    }
}
