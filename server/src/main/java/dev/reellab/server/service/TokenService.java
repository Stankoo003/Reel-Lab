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
 */
@Service
public class TokenService {

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
                .build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(() -> "HS256").build(), claims))
                .getTokenValue();
    }
}
