package dev.reellab.server.web.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * A user's public profile.
 *
 * <p>What is NOT here is the point of the type. There is no email and no credential of any
 * kind, on anybody's profile including your own — not because the fields are forgotten but
 * because this project has no authentication yet, so the server cannot tell "you asking for
 * your own profile" from "anyone claiming to be you". A viewerId in the query string is an
 * assertion, not proof, so returning private data for a matching one would hand every user's
 * email to whoever guessed their id. When auth lands, an authenticated self endpoint can add
 * it; until then the honest answer is that nothing private leaves here.
 *
 * @param avatarUrl absolute, composed from the stored relative path — the database never
 *     holds a URL
 */
public record ProfileResponse(
        UUID id,
        String username,
        String displayName,
        String bio,
        String avatarUrl,
        Instant createdAt,
        ProfileActivity activity) {

    /** What this user has done here. Counts only — no listings, so no data leaks by volume. */
    public record ProfileActivity(long publishedVideos, long comments, long likesReceived) {
    }
}
