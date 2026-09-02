package dev.reellab.server.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

/**
 * The two halves of cursor pagination that every paged endpoint repeats: turning an incoming
 * cursor parameter into a position, and turning the last row of a page into the next one.
 *
 * <p>Written once because the feed and the comment thread had it copied verbatim, including a
 * {@code getLast()} that both guarded by assuming hasNext is never true for an empty page —
 * an invariant enforced in one service and merely assumed in both controllers.
 */
final class CursorPages {

    private CursorPages() {
    }

    /** Null for a first page. Blank is treated as absent, not as a broken cursor. */
    static PageCursor decodeOrNull(String cursor) {
        return cursor == null || cursor.isBlank() ? null : PageCursor.decode(cursor);
    }

    static Instant createdAtOf(PageCursor cursor) {
        return cursor == null ? null : cursor.createdAt();
    }

    static UUID idOf(PageCursor cursor) {
        return cursor == null ? null : cursor.id();
    }

    /**
     * The cursor pointing just past this page, or null when there is nothing after it.
     *
     * @param rows the rows actually returned, which may be empty
     * @param hasNext whether the source found more beyond them
     * @param position how to read the ordering columns off a row
     */
    static <T> String nextCursor(List<T> rows, boolean hasNext, Function<T, PageCursor> position) {
        // Empty is checked rather than assumed: hasNext and rows come from different places,
        // and getLast() on an empty list is a 500.
        if (!hasNext || rows.isEmpty()) {
            return null;
        }
        return position.apply(rows.getLast()).encode();
    }
}
