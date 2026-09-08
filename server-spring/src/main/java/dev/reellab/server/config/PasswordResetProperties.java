package dev.reellab.server.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param ttl how long a reset link works. Short enough that a link left in an inbox or a
 *     proxy log stops being a key before long; long enough to survive a mail queue and a
 *     person who reads their email an hour later.
 * @param perEmailLimit how many requests one account may generate per {@code window}
 * @param perIpLimit how many one host may generate per {@code window}, which is the number
 *     that bounds walking a list of addresses
 * @param responseFloor the fixed time the request endpoint takes to answer, whatever it
 *     actually did. See PasswordResetService for why an endpoint deliberately waits.
 */
@ConfigurationProperties("reellab.password-reset")
public record PasswordResetProperties(Duration ttl, int perEmailLimit, int perIpLimit,
                                      Duration window, Duration responseFloor) {
}
