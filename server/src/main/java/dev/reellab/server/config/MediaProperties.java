package dev.reellab.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where media is served from. Bound from {@code reellab.media.*}, which in turn
 * reads MEDIA_CDN_BASE_URL from the environment.
 *
 * <p>This value is never persisted. The database holds relative paths only, so
 * moving to a different CDN is a configuration change and not a data migration.
 */
@ConfigurationProperties(prefix = "reellab.media")
public record MediaProperties(String cdnBaseUrl) {
}
