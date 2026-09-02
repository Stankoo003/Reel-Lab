package dev.reellab.server.web;

import dev.reellab.server.service.AuthService;
import dev.reellab.server.service.CommentService;
import dev.reellab.server.service.UserService;
import dev.reellab.server.service.exception.ConflictException;
import dev.reellab.server.service.exception.ForbiddenException;
import dev.reellab.server.service.exception.NotFoundException;
import dev.reellab.server.service.exception.ValidationException;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * Maps domain exceptions to HTTP. This is the only place that knows a
 * {@code NotFoundException} means 404 — the service layer never mentions status codes.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** Postgres' unique_violation. Gate on this so only a real duplicate is translated. */
    private static final String UNIQUE_VIOLATION = "23505";

    /**
     * Constraint name to the message a client should see.
     *
     * <p>The messages are the services' own constants, not copies of them: a duplicated string
     * literal that two comments promised to keep in sync by hand is one copy-edit away from
     * making a race answer differently from the pre-check it is supposed to be indistinguishable
     * from.
     */
    private static final Map<String, String> UNIQUE_CONSTRAINT_MESSAGES = Map.of(
            "comments_one_per_author_uq", CommentService.ALREADY_COMMENTED_OR_REPLIED,
            "users_username_key", UserService.USERNAME_TAKEN,
            "users_email_key", UserService.EMAIL_TAKEN);

    @ExceptionHandler(NotFoundException.class)
    public ProblemDetail onNotFound(NotFoundException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler(ValidationException.class)
    public ProblemDetail onInvalid(ValidationException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
    }

    @ExceptionHandler(ConflictException.class)
    public ProblemDetail onConflict(ConflictException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
    }

    /**
     * Authenticated, but not entitled. 403 rather than 404: hiding the resource would be
     * lying to a caller who can already see it on the public read endpoints.
     */
    @ExceptionHandler(ForbiddenException.class)
    public ProblemDetail onForbidden(ForbiddenException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, ex.getMessage());
    }

    /**
     * A failed sign-in. Handled here rather than by the filter chain because it happens
     * inside the login endpoint, which is itself public — nothing has rejected the request,
     * the credentials simply did not match.
     */
    @ExceptionHandler(AuthService.BadCredentialsException.class)
    public ProblemDetail onBadCredentials(AuthService.BadCredentialsException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, ex.getMessage());
    }

    /**
     * A unique constraint the service's pre-check did not catch.
     *
     * <p>Without this the guarantee would be a 500: two concurrent requests both pass their
     * service's pre-check, one commits, and the loser surfaces a driver exception. The database
     * is what actually enforces these rules, so losing that race is a conflict — the same 409
     * the pre-check produces — not a server fault.
     *
     * <p>Only the constraints named above are translated. Anything else is a real bug and must
     * not be dressed up as a client error.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ProblemDetail onDataIntegrityViolation(DataIntegrityViolationException ex) {
        Throwable cause = ex.getMostSpecificCause();
        // The state is the reliable half. The constraint name has to be read out of the driver
        // message because the PostgreSQL driver is a runtime-scoped dependency and its typed
        // accessor is not on the compile classpath here.
        if (cause instanceof SQLException sql && UNIQUE_VIOLATION.equals(sql.getSQLState())) {
            String message = String.valueOf(sql.getMessage());
            for (var entry : UNIQUE_CONSTRAINT_MESSAGES.entrySet()) {
                if (message.contains(entry.getKey())) {
                    return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, entry.getValue());
                }
            }
        }
        throw ex;
    }

    /**
     * An upload larger than {@code spring.servlet.multipart.max-file-size}.
     *
     * <p>Tomcat rejects these before any controller runs, so without a handler a client that
     * picks an oversized file gets a 500 — a routine outcome reported as a server fault.
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ProblemDetail onUploadTooLarge(MaxUploadSizeExceededException ex) {
        return ProblemDetail.forStatusAndDetail(
                HttpStatus.PAYLOAD_TOO_LARGE, "That file is too large to upload.");
    }

    @ExceptionHandler(InvalidCursorException.class)
    public ProblemDetail onInvalidCursor(InvalidCursorException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
    }

    /**
     * Bean-validation failures on a request BODY.
     *
     * <p>Spring's default answer is the string "Invalid request content." and nothing else,
     * which tells a form which of its fields to mark exactly nothing. This adds an
     * {@code errors} object keyed by field name, so a client can put each message against
     * the input that caused it instead of dumping one sentence above the form.
     *
     * <p>ProblemDetail allows extension members precisely for this; the standard fields keep
     * their standard meaning and {@code errors} carries the detail.
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail onInvalidBody(MethodArgumentNotValidException ex) {
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError error : ex.getBindingResult().getFieldErrors()) {
            // First message per field wins: a field with two broken rules still gets one
            // line of text, which is all an input can show.
            errors.putIfAbsent(
                    error.getField(),
                    error.getDefaultMessage() == null ? "is invalid" : error.getDefaultMessage());
        }
        for (ObjectError error : ex.getBindingResult().getGlobalErrors()) {
            errors.putIfAbsent(error.getObjectName(), String.valueOf(error.getDefaultMessage()));
        }

        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST,
                errors.isEmpty()
                        ? "Request body is invalid"
                        // A readable summary as well, for anything that shows only `detail`.
                        : String.join("; ", errors.values()));
        problem.setProperty("errors", errors);
        return problem;
    }

    /**
     * Constraint violations on request parameters — {@code ?limit=0}, say. Spring's default
     * body for these is the literal string "Invalid request content.", which tells a client
     * nothing; this names the parameter and what it expected.
     */
    @ExceptionHandler(HandlerMethodValidationException.class)
    public ProblemDetail onInvalidParameter(HandlerMethodValidationException ex) {
        String detail = ex.getParameterValidationResults().stream()
                .flatMap(result -> result.getResolvableErrors().stream()
                        .map(error -> result.getMethodParameter().getParameterName()
                                + " " + error.getDefaultMessage()))
                .collect(Collectors.joining("; "));
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
                detail.isBlank() ? "Request parameters are invalid" : detail);
    }

    /**
     * A path variable or query parameter that could not be converted at all — most often a
     * video id that is not a UUID. Reported as 400 rather than 404: the request never named
     * a resource that could be missing.
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ProblemDetail onTypeMismatch(MethodArgumentTypeMismatchException ex) {
        Class<?> required = ex.getRequiredType();
        String expected = required == null ? "a different type" : required.getSimpleName();
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
                ex.getName() + " must be a valid " + expected);
    }
}
