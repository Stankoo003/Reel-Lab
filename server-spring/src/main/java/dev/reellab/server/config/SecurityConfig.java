package dev.reellab.server.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import javax.crypto.spec.SecretKeySpec;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import dev.reellab.server.persistence.repository.UserRepository;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import tools.jackson.databind.json.JsonMapper;

/**
 * Who may call what.
 *
 * Reading stays open. The feed and a user's profile are public pages — requiring a token to
 * look at them would make the app useless before sign-in without protecting anything that
 * is not already public. Everything that WRITES requires one, and takes the caller's
 * identity from it rather than from the request body.
 */
@Configuration
public class SecurityConfig {

    private static final String[] PUBLIC_POSTS = {
        "/api/auth/signup",
        "/api/auth/login",
        // Anyone can ask for a reset — the person who needs one is by definition unable to
        // sign in. Abuse is bounded by the rate limiter, not by authentication.
        "/api/auth/password/reset-request",
        "/api/auth/password/reset",
    };

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, JwtDecoder jwtDecoder) throws Exception {
        return http
                // No cookies and no server-side session, so there is no session for a
                // forged cross-site form to ride on. CSRF protection guards a credential
                // the browser attaches automatically; a bearer token is not one.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.POST, PUBLIC_POSTS).permitAll()
                        .requestMatchers("/actuator/**", "/v3/api-docs/**", "/swagger-ui/**").permitAll()
                        // The web fallback page a reset link opens, for a recipient without
                        // the app installed. It is a page, not an API — it carries the token
                        // in its query string and calls the API above.
                        .requestMatchers(HttpMethod.GET, "/reset").permitAll()
                        // Uploaded media, when this instance is the one serving it — see
                        // MediaResourceConfig. Public because a poster and a clip are public
                        // the moment the video they belong to is published, and because a
                        // video player cannot attach a bearer token to its own range
                        // requests. The URL is the secret: every file is named by a UUID
                        // that appears only in a response the caller was allowed to see.
                        .requestMatchers(HttpMethod.GET, "/media/**").permitAll()
                        /*
                          The WebSocket handshake, open at the HTTP layer — and that is not a
                          hole. A socket is authenticated by its STOMP CONNECT frame, not by
                          the upgrade request: the SockJS transports have no single request to
                          carry an Authorization header, and a raw upgrade cannot set one from
                          a client that is not a browser.

                          What makes it safe is that an unauthenticated socket can do nothing.
                          StompAuthInterceptor refuses every SUBSCRIBE and every SEND without
                          the principal that CONNECT establishes, so what this permits is a
                          connection that is allowed to say hello and nothing else.
                        */
                        .requestMatchers("/ws/**").permitAll()
                        // Public to read. A token is still PARSED when one is sent — that is
                        // what lets the feed say whether you liked a clip without asking the
                        // client to assert who it is.
                        .requestMatchers(HttpMethod.GET, "/api/videos/**", "/api/users/**").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(Customizer.withDefaults()))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(problemEntryPoint())
                        .accessDeniedHandler(problemAccessDeniedHandler()))
                .build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    JwtEncoder jwtEncoder(AuthProperties auth) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(key(auth)));
    }

    /**
     * Signature and expiry, plus one rule of our own: a token older than its owner's last
     * password change is refused. See {@link PasswordChangeTokenValidator}.
     */
    @Bean
    JwtDecoder jwtDecoder(AuthProperties auth, UserRepository users) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key(auth)).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefault(),
                new PasswordChangeTokenValidator(users)));
        return decoder;
    }

    private static SecretKeySpec key(AuthProperties auth) {
        return new SecretKeySpec(auth.secret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    /*
     * Spring Security answers 401 and 403 from inside the filter chain — before the
     * dispatcher, and therefore before @RestControllerAdvice ever sees the request. Without
     * these two, those responses would carry an empty body while every other error in the
     * API carries a ProblemDetail, and the client's unwrap() would have nothing to show but
     * the status code.
     */
    private static AuthenticationEntryPoint problemEntryPoint() {
        return (request, response, ex) ->
                writeProblem(response, HttpStatus.UNAUTHORIZED, "Sign in to do that.");
    }

    private static AccessDeniedHandler problemAccessDeniedHandler() {
        return (request, response, ex) ->
                writeProblem(response, HttpStatus.FORBIDDEN, "That is not yours to change.");
    }

    private static void writeProblem(HttpServletResponse response, HttpStatus status, String detail)
            throws IOException {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(JsonMapper.builder().build().writeValueAsString(problem));
    }
}
