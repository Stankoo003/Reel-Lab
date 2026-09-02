package dev.reellab.server.service;

import dev.reellab.server.service.exception.ValidationException;
import java.util.regex.Pattern;

/**
 * The one definition of "a path this system is willing to store".
 *
 * <p>Stored media paths are relative, never URLs — the CDN base is configuration, so it must
 * not be baked into rows. That rule was previously written out separately in UserService and
 * VideoService, in the DTO's @Pattern, and twice in SQL; five copies of one idea, which is why
 * the {@code ..} hole below was uniform rather than isolated when it was found.
 *
 * <p>The database CHECK constraints remain the guarantee. This exists so the caller gets a
 * clear message instead of a constraint violation.
 */
final class MediaPaths {

    private static final Pattern ABSOLUTE_URI = Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*://");

    private MediaPaths() {
    }

    /**
     * @throws ValidationException if the path is absolute, a URL, or escapes upwards
     */
    static void requireRelative(String field, String path) {
        if (path == null) {
            return;
        }
        if (ABSOLUTE_URI.matcher(path).find() || path.startsWith("/")) {
            throw new ValidationException(
                    field + " must be a relative path; the CDN base comes from configuration");
        }
        // A traversal segment is still "relative" by the two rules above, which is exactly how
        // "../../../etc/passwd" used to pass every check in the system and end up composed into
        // a URL. Checked segment by segment so a legitimate name containing dots survives.
        for (String segment : path.split("/")) {
            if (segment.equals("..")) {
                throw new ValidationException(field + " must not contain '..' path segments");
            }
        }
    }
}
