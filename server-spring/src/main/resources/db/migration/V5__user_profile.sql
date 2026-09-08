-- Profile fields. Both nullable: every existing user predates them, and a profile with
-- neither set is a perfectly good profile.
alter table users
    add column bio         text,
    add column avatar_path varchar(500);

-- Same rule as videos.manifest_path: the database stores a RELATIVE path and never a URL,
-- so the CDN base stays a configuration value rather than baked into every row.
alter table users
    add constraint users_avatar_path_relative check (
        avatar_path is null
            or (avatar_path !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' and avatar_path not like '/%'));

-- A bio is a short paragraph, not an essay. Enforced here as well as in the DTO because the
-- column is what the rest of the system has to survive.
alter table users
    add constraint users_bio_length check (bio is null or length(bio) <= 500);
