/**
 * A sliding-window counter keyed by whatever the caller wants to limit on, kept in Postgres
 * so it holds across serverless instances. See db/migration/V14__rate_limits.sql.
 */
import { sql } from "@/db/client";

/** Records one attempt and says whether it is allowed. */
export async function tryAcquire(key: string, limit: number, windowMs: number): Promise<boolean> {
  const seconds = windowMs / 1000;
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from rate_limit_events
    where key = ${key} and at > now() - make_interval(secs => ${seconds})`;
  if (row.n >= limit) return false;
  await sql`insert into rate_limit_events (key) values (${key})`;
  // Opportunistic sweep of this key's stale rows: the table stays bounded without a scheduler.
  if (row.n === 0) {
    await sql`delete from rate_limit_events where key = ${key} and at <= now() - make_interval(secs => ${seconds})`;
  }
  return true;
}
