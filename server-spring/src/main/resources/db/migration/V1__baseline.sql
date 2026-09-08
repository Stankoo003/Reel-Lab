-- ReelLab baseline schema.
-- gen_random_uuid() is built into Postgres 13+, so no pgcrypto extension is needed.

create table users (
    id           uuid primary key     default gen_random_uuid(),
    username     varchar(50)  not null,
    email        varchar(255) not null,
    display_name varchar(100) not null,
    created_at   timestamptz  not null default now(),
    updated_at   timestamptz  not null default now(),
    constraint users_username_uq check (length(trim(username)) > 0),
    constraint users_email_uq_shape check (position('@' in email) > 1)
);

create unique index users_username_key on users (lower(username));
create unique index users_email_key on users (lower(email));

create table videos (
    id               uuid primary key    default gen_random_uuid(),
    -- RESTRICT, not CASCADE: a video row points at media files in object storage.
    -- Cascading a user delete would orphan those files silently.
    owner_id         uuid         not null references users (id) on delete restrict,
    title            varchar(200) not null,
    description      text,
    duration_seconds integer      not null,
    manifest_path    varchar(500) not null,
    poster_path      varchar(500),
    published        boolean      not null default false,
    created_at       timestamptz  not null default now(),
    updated_at       timestamptz  not null default now(),

    constraint videos_title_not_blank check (length(trim(title)) > 0),
    constraint videos_duration_positive check (duration_seconds > 0),

    -- "No CDN URL is stored in the database" is enforced here rather than merely
    -- reviewed: reject anything with a URI scheme or a leading slash.
    constraint videos_manifest_path_relative check (
        manifest_path !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' and manifest_path not like '/%'
    ),
    constraint videos_poster_path_relative check (
        poster_path is null
            or (poster_path !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' and poster_path not like '/%')
    )
);

create index videos_owner_id_idx on videos (owner_id);
-- Feed query: published videos, newest first.
create index videos_published_created_at_idx on videos (published, created_at desc);

create table comments (
    id         uuid primary key   default gen_random_uuid(),
    -- CASCADE: a comment has no meaning without its video.
    video_id   uuid        not null references videos (id) on delete cascade,
    -- RESTRICT, same reasoning as videos. The alternative is a nullable author with
    -- ON DELETE SET NULL, which preserves thread shape and renders as "[deleted]".
    author_id  uuid        not null references users (id) on delete restrict,
    -- NULL = top-level comment, non-null = reply. Self-reference allows arbitrary
    -- depth in the schema; the API deliberately exposes only two levels.
    parent_id  uuid,
    body       text        not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint comments_body_not_blank check (length(trim(body)) > 0),
    constraint comments_not_own_parent check (parent_id is null or parent_id <> id)
);

-- A reply must live on the same video as its parent. A plain foreign key cannot
-- express that, so the parent reference is a composite key including video_id.
alter table comments
    add constraint comments_id_video_uq unique (id, video_id);

alter table comments
    add constraint comments_parent_same_video_fk
        foreign key (parent_id, video_id)
            references comments (id, video_id) on delete cascade;

create index comments_video_created_at_idx on comments (video_id, created_at);
create index comments_parent_id_idx on comments (parent_id);
create index comments_author_id_idx on comments (author_id);
