-- Sliding-window rate limiting, in the database rather than in memory.
--
-- The Spring version kept its counters in a ConcurrentHashMap, which is per instance. On a
-- serverless host every request may land on a fresh instance, so an in-memory counter would
-- allow the full quota per cold start. One row per attempt; the count over the window is the
-- decision, and rows older than any window are swept opportunistically.
create table rate_limit_events (
    key varchar(300) not null,
    at  timestamptz  not null default now()
);
create index rate_limit_events_key_at_idx on rate_limit_events (key, at desc);
