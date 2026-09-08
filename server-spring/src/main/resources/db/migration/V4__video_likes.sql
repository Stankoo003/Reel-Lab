create table video_likes (
    id         uuid primary key   default gen_random_uuid(),
    -- CASCADE: a like has no meaning without its video, and unpublishing or deleting a
    -- video should not leave orphaned counts behind.
    video_id   uuid        not null references videos (id) on delete cascade,
    -- RESTRICT, matching comments: a user with history is not silently removable.
    user_id    uuid        not null references users (id) on delete restrict,
    created_at timestamptz not null default now(),

    -- One like per user per video. A plain UNIQUE is enough here, unlike
    -- comments_one_per_author_uq, which needs NULLS NOT DISTINCT because its parent_id is
    -- nullable — neither column here can be NULL, so the default semantics already hold.
    --
    -- The service checks before inserting so the caller gets a clean answer, but that check
    -- is a courtesy: two concurrent likes both pass it. This is the guarantee.
    constraint video_likes_one_per_user_uq unique (user_id, video_id)
);

-- Counting likes for a page of feed videos: the feed reads counts for ~20 video_ids at a
-- time, and asking "did this viewer like it" is a lookup on the same column pair the unique
-- constraint already indexes.
create index video_likes_video_id_idx on video_likes (video_id);
