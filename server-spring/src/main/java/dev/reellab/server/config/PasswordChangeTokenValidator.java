package dev.reellab.server.config;

import dev.reellab.server.persistence.repository.UserRepository;
import dev.reellab.server.service.TokenService;
import java.util.UUID;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Refuses a token that was issued before its owner's password last changed.
 *
 * <p>This is what "changing the password signs out every device" means when sessions are
 * stateless. There is no session table to delete from — the token IS the session, and it is
 * valid until it expires unless something says otherwise. This is that something.
 *
 * <p>It costs one user lookup per authenticated request. That is a real price and worth
 * naming: the alternative is either short-lived tokens with a refresh flow, or a revocation
 * list in a cache. At this size the lookup is a primary-key read on a table Postgres has in
 * memory, and correctness on "the account was just recovered from someone" is worth more
 * than the microseconds.
 *
 * <p>A token whose subject no longer exists is refused too — a deleted account's session
 * should not outlive it.
 */
public class PasswordChangeTokenValidator implements OAuth2TokenValidator<Jwt> {

    private static final OAuth2Error STALE = new OAuth2Error(
            "invalid_token", "Signed out because the password changed. Sign in again.", null);

    private final UserRepository users;

    public PasswordChangeTokenValidator(UserRepository users) {
        this.users = users;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        // Absent on any token minted before this rule existed. Refusing those is the safe
        // direction — the cost is one extra sign-in, once.
        Object claim = token.getClaim(TokenService.PASSWORD_CLAIM);
        if (!(claim instanceof Number stamp)) {
            return OAuth2TokenValidatorResult.failure(STALE);
        }
        UUID subject;
        try {
            subject = UUID.fromString(token.getSubject());
        } catch (IllegalArgumentException | NullPointerException e) {
            return OAuth2TokenValidatorResult.failure(STALE);
        }

        return users.findById(subject)
                // Equality, not ordering. The claim says which password this token was minted
                // for; if the account's has changed since, the two differ and the token is
                // from before the change. See TokenService.PASSWORD_CLAIM for why comparing
                // `iat` instead does not work.
                .filter(user -> stamp.longValue() == user.getPasswordChangedAt().toEpochMilli())
                .map(user -> OAuth2TokenValidatorResult.success())
                .orElseGet(() -> OAuth2TokenValidatorResult.failure(STALE));
    }
}
