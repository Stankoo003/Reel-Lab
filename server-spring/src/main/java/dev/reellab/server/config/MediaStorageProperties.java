package dev.reellab.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where uploaded media is written.
 *
 * <p>Separate from {@link MediaProperties}: that one says how a stored path is turned
 * into a URL for clients, this one says where the bytes physically live. They are
 * different concerns and will diverge the moment uploads move to object storage —
 * at which point only this class is replaced.
 */
@ConfigurationProperties(prefix = "reellab.media.storage")
public record MediaStorageProperties(String directory, long maxBytes) {
}
