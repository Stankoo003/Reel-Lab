package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.service.AuthService;
import dev.reellab.server.service.TokenService;
import dev.reellab.server.service.UserService;
import dev.reellab.server.web.dto.AuthResponse;
import dev.reellab.server.web.dto.LoginRequest;
import dev.reellab.server.web.dto.SignupRequest;
import dev.reellab.server.web.dto.UserResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sign up, sign in, and "who am I".
 *
 * This replaced {@code POST /api/users}: creating a user and creating an account were the
 * same operation, and keeping both would have left one path that produces a user nobody can
 * ever log in as.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final TokenService tokens;
    private final UserService users;

    public AuthController(AuthService auth, TokenService tokens, UserService users) {
        this.auth = auth;
        this.tokens = tokens;
        this.users = users;
    }

    @PostMapping("/signup")
    public ResponseEntity<AuthResponse> signup(@Valid @RequestBody SignupRequest request) {
        // The display name starts as the username. It is editable on the profile, so this is
        // a starting value rather than a decision.
        UserEntity user = auth.signup(
                request.username(), request.email(), request.username(), request.password());
        return ResponseEntity.status(HttpStatus.CREATED).body(AuthResponse.of(tokens.issue(user), user));
    }

    /**
     * Answers 200 with a token, or 401. Never 404 for an unknown address — see
     * {@link AuthService#BAD_CREDENTIALS}.
     */
    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        UserEntity user = auth.authenticate(request.email(), request.password());
        return AuthResponse.of(tokens.issue(user), user);
    }

    /**
     * Confirms a stored token is still good, and returns the current user with it. The
     * client calls this on launch: a token that has expired or was signed with a retired
     * secret fails here rather than on the first thing the user tries to do.
     */
    @GetMapping("/me")
    public UserResponse me(@AuthenticationPrincipal Jwt jwt) {
        return UserResponse.from(users.require(CurrentUser.id(jwt)));
    }
}
