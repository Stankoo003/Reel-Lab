package dev.reellab.server.web;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Reads the caller's id out of their token.
 *
 * One place, because "the subject claim holds the user id" is a fact about how tokens are
 * issued (see TokenService) and every controller that parsed it itself would be a second
 * copy of that fact.
 */
final class CurrentUser {

    private CurrentUser() {
    }

    /** The caller's id. Only for endpoints the filter chain already requires a token for. */
    static UUID id(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

    /**
     * The caller's id, or null when the request is anonymous.
     *
     * <p>For the public read endpoints: they work signed out, and use this to answer
     * viewer-specific questions — "did I like this" — when a token happens to be present.
     */
    static UUID idOrNull(Jwt jwt) {
        return jwt == null ? null : UUID.fromString(jwt.getSubject());
    }
}
