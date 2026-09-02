package dev.reellab.server.web;

/**
 * A feed cursor the server did not produce, or that no longer decodes.
 *
 * <p>Lives in the web layer because a cursor is a transport concept: the service knows
 * only about a timestamp and an id. Deliberately not {@code ValidationException}, which is
 * mapped to 422 — a broken cursor is a malformed request, so it is a 400.
 */
public class InvalidCursorException extends RuntimeException {

    public InvalidCursorException(String message) {
        super(message);
    }
}
