package dev.reellab.server.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Token signing settings.
 *
 * The secret is symmetric (HMAC), which is the right shape here: one service both issues
 * and verifies. An asymmetric key pair earns its extra machinery only when the verifier is
 * someone other than the issuer.
 *
 * @param secret HMAC key. Must be at least 32 bytes — HS256 refuses anything shorter, so a
 *               weak secret fails at startup rather than producing weak tokens.
 * @param ttl    How long an issued token stays valid. There is no refresh token, so this is
 *               also how long a signed-in user stays signed in.
 */
@ConfigurationProperties("reellab.auth")
public record AuthProperties(String secret, Duration ttl) {}
