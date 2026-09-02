package dev.reellab.server.service.exception;

/**
 * A business rule was broken — as opposed to a malformed request, which bean
 * validation rejects before the service is reached. The web layer maps this to 422.
 */
public class ValidationException extends RuntimeException {

    public ValidationException(String message) {
        super(message);
    }
}
