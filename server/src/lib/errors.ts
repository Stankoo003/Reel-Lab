/**
 * Domain errors, each carrying the HTTP status the web layer answers with. Same mapping as the
 * Spring GlobalExceptionHandler: business validation is 422, a malformed body is 400.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string>
  ) {
    super(message);
  }
}

export class NotFoundError extends ApiError {
  constructor(what: string, id: string) {
    super(404, `${what} ${id} not found`);
  }
}

/** A rule of the domain the request breaks — 422. */
export class ValidationError extends ApiError {
  constructor(message: string) {
    super(422, message);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string) {
    super(403, message);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(401, message);
  }
}

export class TooManyRequestsError extends ApiError {
  constructor(message: string) {
    super(429, message);
  }
}

/** A cursor that this server did not produce — 400, not 422: the request is malformed. */
export class InvalidCursorError extends ApiError {
  constructor() {
    super(400, "cursor is not a valid cursor; pass back the nextCursor from a previous response");
  }
}

export const NOT_YOURS = "That is not yours to change.";
export const SIGN_IN = "Sign in to do that.";

/** The rule the whole API rests on: you may only change your own things. */
export function requireSelf(actor: string, owner: string, what: string): void {
  if (actor !== owner) throw new ForbiddenError(`That ${what} is not yours to change.`);
}
