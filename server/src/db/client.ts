/**
 * The one database connection pool.
 *
 * Timestamps are deliberately NOT parsed into JS Dates. A timestamptz carries microseconds and
 * a Date carries milliseconds; keyset pagination compares the exact stored value, so a cursor
 * built from a truncated Date would skip or repeat rows that share a millisecond. Every
 * timestamp travels through this server as the text Postgres produced, and lib/time.ts turns
 * that into ISO-8601 for a response.
 *
 * Created lazily on first use — `next build` imports every route to collect its configuration,
 * and must not need a database to do so — and cached on globalThis so `next dev`'s hot reloads
 * do not open a new pool per change and a serverless instance reuses it across invocations.
 */
import postgres, { type Sql } from "postgres";
import { config } from "@/lib/config";

const TIMESTAMPTZ = 1184;
const TIMESTAMP = 1114;
const DATE = 1082;

declare global {
  // eslint-disable-next-line no-var
  var __reellabSql: Sql | undefined;
}

function create(): Sql {
  return postgres(config.databaseUrl, {
    max: config.isServerless ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { TimeZone: "UTC" },
    onnotice: () => {},
    types: {
      // Keep temporal columns as text — see the file comment.
      timestamp: { to: TIMESTAMPTZ, from: [TIMESTAMPTZ, TIMESTAMP, DATE], serialize: (x: string) => x, parse: (x: string) => x },
      // count(*) and friends come back as bigint text; the API answers with numbers.
      bigint: { to: 20, from: [20], serialize: (x: number | string) => String(x), parse: (x: string) => Number(x) },
    },
  });
}

function instance(): Sql {
  return globalThis.__reellabSql ?? (globalThis.__reellabSql = create());
}

/** Behaves exactly like a postgres.js `sql` tag; the pool behind it opens on first use. */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_target, _this, args: unknown[]) => (instance() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, prop) => {
    const real = instance() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
