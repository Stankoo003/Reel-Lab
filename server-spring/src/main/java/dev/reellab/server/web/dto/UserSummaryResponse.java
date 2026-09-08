package dev.reellab.server.web.dto;

import java.util.UUID;

/**
 * One row of a people list — search results today, and anything else that lists users later.
 *
 * <p>Deliberately not {@link UserResponse}: that record is the account as the API talks about
 * it, and a result row needs the two things a list has to draw, an avatar and a line of bio,
 * which it does not carry. Deliberately not {@link ProfileResponse} either: a search for five
 * letters would otherwise run three count queries per result, and a row shows none of them.
 *
 * <p>The avatar arrives as an absolute URL, assembled by the web layer from the relative path
 * the database stores — the same composition the feed does.
 */
public record UserSummaryResponse(
        UUID id, String username, String displayName, String bio, String avatarUrl) {
}
