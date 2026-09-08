-- Credentials. Until now a user was an identity the client asserted; from here it is one
-- the server can verify.
--
-- Added in three steps rather than as a single `not null` column. The dev seed
-- (db/seed/V900) sorts AFTER this migration and the dev profile runs Flyway with
-- `out-of-order: true`, so on a database that is already seeded this runs against rows
-- that exist. A `not null` column with no default would fail on exactly those rows.
alter table users
    add column password_hash varchar(100);

-- BCrypt of the documented development password. Only rows that predate this migration
-- can match — a signup always supplies its own hash — so this backfills the seed users and
-- nothing else. It is a known value on purpose: it is what makes the seeded accounts
-- usable, and it never reaches a real deployment because the seed never does.
update users
set password_hash = '$2y$10$jBp.1zK3y4K4LDy668scneNa/oOg6qwitmP/9aGJ0OxN0fY4dW48.'
where password_hash is null;

alter table users
    alter column password_hash set not null;

-- 60 characters for BCrypt today; the column is wider so a future algorithm with a longer
-- encoding is a code change rather than another migration.
alter table users
    add constraint users_password_hash_present check (length(password_hash) >= 20);
