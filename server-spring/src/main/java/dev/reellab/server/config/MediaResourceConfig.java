package dev.reellab.server.config;

import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import java.time.Duration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Serve uploaded media over the API's own host.
 *
 * <p>Locally a separate static server on :8090 does this, and deployed it is meant to be a
 * CDN — the database stores relative paths precisely so the host in front of them can
 * change without a migration. This is the third case: a single deployed instance with a
 * volume, where standing up a second service to serve one directory would be more moving
 * parts than the thing is worth.
 *
 * <p>Which one is in use is decided entirely by {@code MEDIA_CDN_BASE_URL}. Point it at R2
 * and this handler simply stops being asked for anything; nothing here has to be removed.
 *
 * <p>Range requests come free: Spring's resource handler answers them, which is what lets a
 * player seek in an mp4 instead of downloading it whole before the first frame.
 */
@Configuration
public class MediaResourceConfig implements WebMvcConfigurer {

    private final MediaStorageProperties storage;

    public MediaResourceConfig(MediaStorageProperties storage) {
        this.storage = storage;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path root = Paths.get(storage.directory()).toAbsolutePath().normalize();
        registry.addResourceHandler("/media/**")
                // The trailing separator is required: without it Spring treats the value as
                // a file rather than a directory and resolves every request to nothing.
                .addResourceLocations(root.toUri().toString().endsWith("/")
                        ? root.toUri().toString()
                        : root.toUri() + "/")
                // Every file is named by a UUID and never rewritten, so a long cache cannot
                // serve a stale one — the name changes when the content does.
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(30)).cachePublic());
    }
}
