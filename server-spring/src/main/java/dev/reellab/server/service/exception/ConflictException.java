package dev.reellab.server.service.exception;

/**
 * The request collides with something that already exists. The web layer maps this to 409.
 *
 * <p>Distinct from {@link ValidationException} (422): that one means the request itself is
 * unacceptable, this one means the request is fine but the current state refuses it — so
 * retrying identical input will keep failing until that state changes.
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
