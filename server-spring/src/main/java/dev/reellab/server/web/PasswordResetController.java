package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.service.PasswordResetService;
import dev.reellab.server.web.dto.MessageResponse;
import dev.reellab.server.web.dto.PasswordResetConfirm;
import dev.reellab.server.web.dto.PasswordResetRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Forgotten passwords.
 *
 * <p>Both endpoints are open, because someone who cannot sign in cannot authenticate to ask
 * for help signing in. What bounds them is the rate limiter, and what protects the account
 * is that the token goes to the mailbox rather than to the caller.
 */
@RestController
@RequestMapping("/api/auth/password")
public class PasswordResetController {

    private final PasswordResetService resets;

    public PasswordResetController(PasswordResetService resets) {
        this.resets = resets;
    }

    /**
     * Always the same answer.
     *
     * <p>200 with one fixed sentence, whether or not the address has an account — and after
     * a fixed time, so the two cannot be told apart by a stopwatch either. A 404 here, or a
     * faster "no such user", would let anyone test a list of a million addresses against
     * this server and learn which ones are registered.
     */
    @PostMapping("/reset-request")
    public MessageResponse request(@Valid @RequestBody PasswordResetRequest request,
                                   HttpServletRequest http) {
        resets.request(request.email(), clientIp(http));
        return new MessageResponse(PasswordResetService.REQUEST_ACCEPTED);
    }

    /**
     * Spend the token.
     *
     * <p>Answers with a message rather than a session: after a reset you sign in with the
     * new password, which proves it is the one you meant to set. Handing back a token here
     * would also mean the reset link itself grants a session, which is one more thing a
     * leaked link would be worth.
     */
    @PostMapping("/reset")
    public MessageResponse reset(@Valid @RequestBody PasswordResetConfirm request) {
        UserEntity user = resets.reset(request.token(), request.newPassword());
        return new MessageResponse(
                "Password changed for " + user.getUsername() + ". Sign in with it.");
    }

    /**
     * Who is asking, for the per-IP limit.
     *
     * <p>X-Forwarded-For first because in any deployment behind a proxy the socket address is
     * the proxy's. Its first entry is the client as the nearest trusted hop saw it; a header
     * a client sets itself can lie, which is why this bounds abuse rather than identifying
     * anyone. The socket address is the fallback for running with nothing in front.
     */
    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        String remote = request.getRemoteAddr();
        return remote == null ? "unknown" : remote;
    }
}
