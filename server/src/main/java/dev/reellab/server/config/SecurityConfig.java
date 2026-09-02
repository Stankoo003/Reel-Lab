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

    private static final String[] PUBLIC_POSTS = {"/api/auth/signup", "/api/auth/login"};

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

    @Bean
    JwtDecoder jwtDecoder(AuthProperties auth) {
        return NimbusJwtDecoder.withSecretKey(key(auth)).build();
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
