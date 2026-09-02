-- The feed reads published rows only, newest first, tie-broken by id. A partial index
-- on exactly that ordering lets the keyset scan walk the index instead of sorting, and
-- keeps unpublished rows out of it entirely.
--
-- videos_published_created_at_idx stays: it still serves the offset listing, which also
-- queries unpublished rows.
create index videos_feed_keyset_idx on videos (created_at desc, id desc) where published;
