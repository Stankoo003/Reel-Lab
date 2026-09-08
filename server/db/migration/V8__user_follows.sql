-- Following another user.
--
-- Modelled exactly like video_likes: a follow is a row's EXISTENCE, not a boolean to toggle.
-- Unfollowing deletes the row and following again inserts a new one, so there is no state
-- machine to reason about and no updated_at to keep honest.
create table user_follows (
    id          uuid primary key   default gen_random_uuid(),
    -- Who is doing the following.
    follower_id uuid        not null references users (id) on delete cascade,
    -- Who is being followed.
    followee_id uuid        not null references users (id) on delete cascade,
    created_at  timestamptz not null default now(),

    -- CASCADE on both, unlike video_likes.user_id which is RESTRICT. A like is a record of
    -- something a user did to someone else's content, so it holds that user in place; a
    -- follow is a relationship between two accounts and means nothing once either is gone.

    -- One follow per pair. The service checks before inserting so the caller gets a clean
    -- answer, but that check is a courtesy — two concurrent follows both pass it. This is
    -- the guarantee, and it is what makes ON CONFLICT DO NOTHING possible.
    constraint user_follows_one_per_pair_uq unique (follower_id, followee_id),

    -- You cannot follow yourself. Enforced here as well as in the service because a self
    -- follow would inflate both of a user's own counts and there is no reading of the
    -- feature under which it means anything.
    constraint user_follows_not_self check (follower_id <> followee_id)
);

-- "How many followers does this user have" and "which of these people do I follow" read
-- opposite columns, and the unique constraint above only indexes (follower_id, followee_id).
-- This is the other direction.
create index user_follows_followee_id_idx on user_follows (followee_id);
