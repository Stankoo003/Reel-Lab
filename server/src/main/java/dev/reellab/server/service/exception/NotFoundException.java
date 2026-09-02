package dev.reellab.server.service.exception;

/** A referenced entity does not exist. The web layer maps this to 404. */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String what, Object id) {
        super(what + " " + id + " not found");
    }
}
