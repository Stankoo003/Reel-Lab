-- The comment thread reads one video's top-level comments, oldest first, tie-broken by id —
-- the mirror of the feed's keyset walk, which got its index in V2 while this one never did.
--
-- comments_video_created_at_idx (video_id, created_at) cannot serve it: it has no id to walk
-- the tie-break with, and no way to skip replies, which on a busy thread are most of the rows.
create index comments_thread_keyset_idx
    on comments (video_id, created_at, id)
    where parent_id is null;
