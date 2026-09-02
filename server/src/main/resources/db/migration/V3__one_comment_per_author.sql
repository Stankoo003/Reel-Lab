-- One top-level comment and one reply per author per video.
--
-- NULLS NOT DISTINCT is the entire point of this constraint. parent_id is NULL for a
-- top-level comment, and under the SQL default two NULLs are never equal — so a plain
-- UNIQUE (author_id, video_id, parent_id) would correctly limit replies while letting an
-- author post unlimited top-level comments, which is the case that matters most. Postgres
-- 15+ only; this project runs 16 in tests and 17 in compose.
--
-- The service pre-checks and returns a clean 409, but that check is a courtesy: two
-- concurrent requests both pass it and only one can win. This is the guarantee.
alter table comments
    add constraint comments_one_per_author_uq
        unique nulls not distinct (author_id, video_id, parent_id);
