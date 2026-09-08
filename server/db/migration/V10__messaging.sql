-- Direct messages: 1:1, text only.
--
-- The "1:1" is enforced by the SHAPE of this table rather than by a rule somewhere in Java.
-- A participants table would allow three rows and a group chat by accident; two columns
-- cannot. The canonical ordering below then makes "the conversation between these two
-- people" a single unique row, which is what lets get-or-create be one statement instead of
-- a read-then-write race that produces duplicate threads.
create table conversations (
    id              uuid primary key   default gen_random_uuid(),
    -- Always the lexicographically smaller id, so (a,b) and (b,a) are the same row.
    user_a_id       uuid        not null references users (id) on delete cascade,
    user_b_id       uuid        not null references users (id) on delete cascade,
    -- Denormalised so the conversation LIST can order by recency without touching messages.
    -- A list query that joined and sorted a million messages to find the newest per thread
    -- is the query that makes a chat app feel slow.
    last_message_at timestamptz,
    created_at      timestamptz not null default now(),

    constraint conversations_pair_uq unique (user_a_id, user_b_id),
    -- Both halves of the canonical form. Without the ordering check the unique constraint
    -- above would happily hold both (a,b) and (b,a).
    constraint conversations_ordered check (user_a_id < user_b_id),
    constraint conversations_not_self check (user_a_id <> user_b_id)
);

create index conversations_user_a_idx on conversations (user_a_id, last_message_at desc);
create index conversations_user_b_idx on conversations (user_b_id, last_message_at desc);

create table messages (
    id              uuid primary key   default gen_random_uuid(),
    conversation_id uuid        not null references conversations (id) on delete cascade,
    sender_id       uuid        not null references users (id) on delete cascade,
    -- Plain text. Nothing reads this as markup: no renderer on either side interprets it,
    -- and the column has no idea what HTML is.
    body            text        not null,
    created_at      timestamptz not null default now(),

    constraint messages_body_not_blank check (length(trim(body)) > 0),
    constraint messages_body_length check (length(body) <= 4000)
);

-- The thread pages backwards from the newest, keyed on (created_at, id) — the same keyset
-- shape the video feed uses, and for the same reason: an OFFSET page shifts under inserts,
-- and a chat is the one place where inserts arrive while you are reading.
create index messages_thread_idx on messages (conversation_id, created_at desc, id desc);

-- How much of a thread each participant has read. A row per (conversation, user) rather
-- than a flag per message: unread is a COUNT over a watermark, which stays one indexed
-- query no matter how long the thread gets.
create table conversation_reads (
    conversation_id uuid        not null references conversations (id) on delete cascade,
    user_id         uuid        not null references users (id) on delete cascade,
    last_read_at    timestamptz not null,

    primary key (conversation_id, user_id)
);

-- Blocking. Directional: A blocking B says nothing about B blocking A, and both rows can
-- exist. What it means is checked in both directions before a message is accepted.
create table user_blocks (
    id         uuid primary key   default gen_random_uuid(),
    blocker_id uuid        not null references users (id) on delete cascade,
    blocked_id uuid        not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),

    constraint user_blocks_pair_uq unique (blocker_id, blocked_id),
    constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on user_blocks (blocked_id);

-- Reports. The message is kept by reference rather than copied: ON DELETE CASCADE would
-- destroy the evidence with the message, so this holds the message id and a snapshot of the
-- body as it was reported. A report whose subject can vanish is not a report.
create table message_reports (
    id          uuid primary key   default gen_random_uuid(),
    message_id  uuid        not null references messages (id) on delete cascade,
    reporter_id uuid        not null references users (id) on delete cascade,
    -- What the reporter actually saw, at the moment they saw it.
    body_at_report text      not null,
    reason      varchar(500),
    created_at  timestamptz not null default now(),

    -- One report per person per message. A second one is the same complaint twice.
    constraint message_reports_one_per_reporter_uq unique (message_id, reporter_id)
);
