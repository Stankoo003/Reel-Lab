/**
 * The web layer's plumbing: JSON in, JSON or ProblemDetail out.
 *
 * Errors are RFC 7807 bodies, as the Spring backend sent them: `{type, title, status, detail}`
 * plus an `errors` object keyed by field for a malformed body. The client reads `detail` and
 * `errors` and nothing else.
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constraint name → the message the pre-check would have produced. Only these are 409s. */
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  comments_one_per_author_uq: "You have already posted here. Edit your existing comment instead.",
  users_username_key: "That username is already taken.",
  users_email_key: "That email is already registered.",
};

const TITLES: Record<number, string> = {
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict",
  413: "Payload Too Large", 422: "Unprocessable Entity", 429: "Too Many Requests", 500: "Internal Server Error",
};

export function problem(status: number, detail: string, errors?: Record<string, string>): NextResponse {
  const body: Record<string, unknown> = { type: "about:blank", title: TITLES[status] ?? "Error", status, detail };
  if (errors) body.errors = errors;
  return NextResponse.json(body, { status, headers: { "content-type": "application/problem+json" } });
}

export function json(body: unknown, init?: { status?: number; headers?: Record<string, string> }): NextResponse {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: init?.headers });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response>;

/** Wraps a route handler so every failure becomes a ProblemDetail rather than a stack trace. */
export function route(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return toResponse(e);
    }
  };
}

function toResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) return problem(e.status, e.message, e.errors);
  if (e instanceof ZodError) {
    const errors: Record<string, string> = {};
    for (const issue of e.issues) {
      const field = issue.path.length ? issue.path.join(".") : "body";
      if (!(field in errors)) errors[field] = issue.message;
    }
    const detail = Object.keys(errors).length ? Object.values(errors).join("; ") : "Request body is invalid";
    return problem(400, detail, errors);
  }
  const pg = e as { code?: string; constraint_name?: string; message?: string };
  if (pg?.code === "23505") {
    const name = pg.constraint_name ?? "";
    for (const [constraint, message] of Object.entries(UNIQUE_CONSTRAINT_MESSAGES)) {
      if (name === constraint || pg.message?.includes(constraint)) return problem(409, message);
    }
  }
  console.error(e);
  return problem(500, "Something went wrong.");
}

/** The JSON body, validated. Absent or non-JSON is a 400 like a body that fails validation. */
export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "Request body is not valid JSON");
  }
  return schema.parse(raw);
}

/** A path variable that must be a UUID. 400, not 404: the request never named a resource. */
export async function uuidParam(ctx: Ctx, name: string): Promise<string> {
  const value = (await ctx.params)[name];
  if (!value || !UUID.test(value)) throw new ApiError(400, `${name} must be a valid UUID`);
  return value.toLowerCase();
}

export function query(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

export function uuidQuery(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  if (value == null || value === "") return null;
  if (!UUID.test(value)) throw new ApiError(400, `${name} must be a valid UUID`);
  return value.toLowerCase();
}

/** An integer query parameter, bounded. Out of range is a 400 that names the parameter. */
export function intQuery(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new ApiError(400, `${name} must be a valid int`);
  if (n < min) throw new ApiError(400, `${name} must be greater than or equal to ${min}`);
  if (n > max) throw new ApiError(400, `${name} must be less than or equal to ${max}`);
  return n;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Who is asking, for the per-IP limit. First X-Forwarded-For entry, as the proxy saw it. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
