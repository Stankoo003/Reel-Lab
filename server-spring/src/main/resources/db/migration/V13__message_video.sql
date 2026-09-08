-- A message can carry a video: sharing a clip from the feed into a thread.
--
-- By reference, not by copy. The card in the thread is drawn from the video row as it is
-- NOW — a retitled clip shows its new title — and a deleted one leaves the message in place
-- with nothing to show, which the client says in words. Cascading the message away would
-- take a line of conversation with it.
alter table messages
    add column video_id  uuid    references videos (id) on delete set null,
    -- Whether a clip was ever attached. Survives the clip's deletion, which video_id does
    -- not, and is what lets the thread say "video removed" rather than showing a blank.
    add column had_video boolean not null default false;

-- A shared video needs no words. The text rule stands for everything else. Checked against
-- had_video rather than video_id, because the SET NULL on delete would otherwise trip this
-- constraint and refuse to delete the clip.
alter table messages drop constraint messages_body_not_blank;
alter table messages
    add constraint messages_body_or_video
        check (length(trim(body)) > 0 or had_video);

create index messages_video_idx on messages (video_id) where video_id is not null;
