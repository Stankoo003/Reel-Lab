package dev.reellab.server.web;

import dev.reellab.server.config.MediaProperties;
import org.springframework.stereotype.Component;

/**
 * Turns a stored relative media path into an absolute URL for the response.
 *
 * <p>This lives in the web layer deliberately. It is a presentation concern: the
 * service layer deals in stored paths and knows nothing about how a client will
 * fetch the bytes.
 */
@Component
public class MediaUrlAssembler {

    private final String base;

    public MediaUrlAssembler(MediaProperties properties) {
        String configured = properties.cdnBaseUrl();
        this.base = configured.endsWith("/") ? configured.substring(0, configured.length() - 1)
                : configured;
    }

    public String toUrl(String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            return null;
        }
        return base + "/" + relativePath;
    }
}
