-- A person's actual name, separate from the name they go by.
--
-- display_name is what the app SHOWS in headings and beside their videos, and it can be
-- anything. This is the real name, and it sits under the display name on the profile — the
-- line that used to hold a follower count, which had nothing to do with identity.
--
-- Nullable, because it is nobody's obligation to give one. Every existing row starts null
-- rather than being backfilled from display_name: a display name is not evidence of a real
-- name, and copying it would fabricate an answer the user never gave.
alter table users add column full_name varchar(100);

alter table users
    add constraint users_full_name_not_blank
        check (full_name is null or length(trim(full_name)) > 0);
