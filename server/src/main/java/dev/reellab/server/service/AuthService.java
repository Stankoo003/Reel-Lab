package dev.reellab.server.service;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.persistence.repository.UserRepository;
import dev.reellab.server.service.exception.ConflictException;
import dev.reellab.server.service.exception.ValidationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Signing up and signing in.
 *
 * The password never leaves this class in a form anyone could use: it arrives raw, is
 * hashed immediately, and is compared through the encoder rather than by equality.
 */
@Service
public class AuthService {

    /**
     * One message for both "no such email" and "wrong password". Telling the two apart
     * would turn the login form into a way to discover which addresses have accounts.
     */
    public static final String BAD_CREDENTIALS = "That email and password do not match.";

    /** Mirrors the client's rule in src/auth.ts. The server is the one that decides. */
    public static final int MIN_PASSWORD = 8;

    private final UserRepository users;
    private final PasswordEncoder encoder;

    public AuthService(UserRepository users, PasswordEncoder encoder) {
        this.users = users;
        this.encoder = encoder;
    }

    @Transactional
    public UserEntity signup(String username, String email, String displayName, String rawPassword) {
        if (rawPassword == null || rawPassword.length() < MIN_PASSWORD) {
            throw new ValidationException("Use at least " + MIN_PASSWORD + " characters.");
        }
        // Checked up front so the common case gets the friendly message. The unique indexes
        // are what actually guarantee it — two simultaneous signups both pass this check,
        // and the loser is turned into the same 409 by GlobalExceptionHandler.
        if (users.existsByUsernameIgnoreCase(username)) {
            throw new ConflictException(UserService.USERNAME_TAKEN);
        }
        if (users.existsByEmailIgnoreCase(email)) {
            throw new ConflictException(UserService.EMAIL_TAKEN);
        }
        return users.save(new UserEntity(username, email, displayName, encoder.encode(rawPassword)));
    }

    @Transactional(readOnly = true)
    public UserEntity authenticate(String email, String rawPassword) {
        UserEntity user = users.findByEmailIgnoreCase(email)
                .orElse(null);
        // The hash is verified even when no user was found, against a throwaway value, so
        // that a missing account and a wrong password take the same time to answer. Without
        // it, the difference is measurable and tells an attacker which emails are registered.
        String hash = user == null ? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv" : user.getPasswordHash();
        boolean matches = encoder.matches(rawPassword == null ? "" : rawPassword, hash);
        if (user == null || !matches) {
            throw new BadCredentialsException(BAD_CREDENTIALS);
        }
        return user;
    }

    /** A failed sign-in. Its own type so the web layer can answer 401 rather than 422. */
    public static class BadCredentialsException extends RuntimeException {
        public BadCredentialsException(String message) {
            super(message);
        }
    }
}
