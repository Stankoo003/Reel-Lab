-- Password reset.
--
-- The row stores a HASH of the token, never the token itself. A reset link is a bearer
-- credential: whoever holds it can take the account. If this table held them in plaintext,
-- a leaked database dump — or a stray backup, or a log of a query — would be a set of
-- working reset links for every account that had recently asked for one.
--
-- SHA-256 rather than bcrypt, deliberately. Bcrypt is the right choice for PASSWORDS
-- because they are low-entropy and guessable, and slowness is what makes guessing
-- expensive. A reset token is 256 bits of CSPRNG output: it cannot be guessed at any
-- speed, so there is nothing for a slow hash to buy. And it must be LOOKED UP by hash,
-- which bcrypt's per-row salt makes impossible without scanning the table.
create table password_resets (
    id           uuid primary key   default gen_random_uuid(),
    user_id      uuid        not null references users (id) on delete cascade,
    -- Hex of SHA-256: 64 characters, always. varchar rather than char because Postgres
    -- reports char(n) as bpchar and blank-pads it, which Hibernate's schema validation
    -- rejects against a String field — and padding a fixed-width hash buys nothing anyway.
    token_hash   varchar(64) not null,
    expires_at   timestamptz not null,
    -- Set the moment the token is spent. A consumed row is KEPT rather than deleted so
    -- that reusing a link can be answered with certainty rather than with "unknown token".
    consumed_at  timestamptz,
    -- What asked for it. Kept for rate limiting and for reading an abuse pattern later;
    -- nullable because a request through a proxy may not carry one.
    requested_ip varchar(45),
    created_at   timestamptz not null default now(),

    constraint password_resets_token_hash_uq unique (token_hash)
);

-- "Every outstanding token for this user", which is what a new request invalidates and
-- what a completed reset clears.
create index password_resets_user_id_idx on password_resets (user_id);

-- Sessions are stateless JWTs, so there is nothing to delete when a password changes.
-- This is what replaces deletion: every token issued before this instant is refused. It is
-- set on a reset, and it is why a stolen session dies when the owner recovers the account.
--
-- Defaults to now() for existing rows, which is correct rather than convenient: nobody's
-- password has changed since, so no token predates it.
alter table users add column password_changed_at timestamptz not null default now();
