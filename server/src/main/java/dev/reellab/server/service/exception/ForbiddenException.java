package dev.reellab.server.service.exception;

/**
 * The caller is who they say they are, but this is not theirs.
 *
 * Distinct from a 401: sending a different token would not help, so the client must not
 * respond by asking the user to sign in again.
 */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
