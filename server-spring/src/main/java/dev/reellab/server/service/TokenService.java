package dev.reellab.server.service;

import dev.reellab.server.config.AuthProperties;
import dev.reellab.server.persistence.entity.UserEntity;
import java.time.Instant;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

/**
 * Issues the token a signed-in client sends back on every request.
 *
 * The subject is the user's id, and that is the whole payload that matters: everything else
 * about the user is read from the database when it is needed, so nothing here can go stale.
 * A display name baked into a token would keep showing the old one until it expired.
 *
 * The one exception is {@link #PASSWORD_CLAIM}, and it is an exception for a reason: it does
 * not describe the user, it records WHICH password this token was minted for. That is what
 * lets a password change invalidate every session that predates it — see
 * PasswordChangeTokenValidator.
 */
@Service
public class TokenService {

    /**
     * When the account's password last changed, in epoch millis, as of the moment this token
     * was issued.
     *
     * <p>Compared for EQUALITY against the stored value, not for ordering against {@code iat}.
     * That comparison was the first thing tried and it is subtly wrong: {@code iat} is a JWT
     * NumericDate and has one-second resolution, while the stored instant has microseconds —
     * so a token issued in the same second as the change either always loses (signing out
     * users the instant they sign up) or always wins (leaving a one-second hole through which
     * an intruder's fresh session survives the reset meant to kill it). An exact value has
     * neither problem.
     */
    public static final String PASSWORD_CLAIM = "pwd";

    private final JwtEncoder encoder;
    private final AuthProperties auth;

    public TokenService(JwtEncoder encoder, AuthProperties auth) {
        this.encoder = encoder;
        this.auth = auth;
    }

    public String issue(UserEntity user) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("reellab")
                .issuedAt(now)
                .expiresAt(now.plus(auth.ttl()))
                .subject(user.getId().toString())
                .claim(PASSWORD_CLAIM, user.getPasswordChangedAt().toEpochMilli())
                .build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(() -> "HS256").build(), claims))
                .getTokenValue();
    }
}
