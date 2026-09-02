package dev.reellab.server.web;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.UUID;

/**
 * The position of the last row a client has seen: a timestamp and the id that breaks its
 * ties. Every keyset-paginated list here orders by exactly that pair, ascending or
 * descending, so one cursor type serves all of them.
 *
 * <p>Encoded opaquely so the wire format stays ours to change — clients only ever echo back
 * the {@code nextCursor} they were given, never build one. Base64 <em>URL</em> alphabet
 * without padding, so a cursor survives a query string untouched.
 */
public record PageCursor(Instant createdAt, UUID id) {

    private static final String SEPARATOR = "|";
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private static final String INVALID =
            "cursor is not a valid cursor; pass back the nextCursor from a previous response";

    public String encode() {
        String raw = createdAt.toString() + SEPARATOR + id;
        return ENCODER.encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * @throws InvalidCursorException for anything that is not a cursor this class produced —
     *     the caller gets one 400 with one message rather than a decoding stack trace.
     */
    public static PageCursor decode(String encoded) {
        String raw;
        try {
            raw = new String(DECODER.decode(encoded), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ex) {
            throw new InvalidCursorException(INVALID);
        }

        int separator = raw.indexOf(SEPARATOR);
        if (separator < 0) {
            throw new InvalidCursorException(INVALID);
        }

        try {
            return new PageCursor(
                    Instant.parse(raw.substring(0, separator)),
                    UUID.fromString(raw.substring(separator + 1)));
        } catch (DateTimeParseException | IllegalArgumentException ex) {
            throw new InvalidCursorException(INVALID);
        }
    }
}
