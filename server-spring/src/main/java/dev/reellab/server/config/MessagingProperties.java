package dev.reellab.server.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param sendLimit how many messages one user may send per {@code sendWindow}
 * @param pageSize how many messages one page of a thread holds
 */
@ConfigurationProperties("reellab.messaging")
public record MessagingProperties(int sendLimit, Duration sendWindow, int pageSize) {
}
