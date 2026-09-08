-- Delivery receipts: the second tick.
--
-- A second watermark next to the read one rather than a flag per message, for the same
-- reason the read one is a watermark: "which of my messages has the other side received" is
-- then a comparison against one instant, not a join over the thread. Read implies delivered,
-- so the existing rows are backfilled from what they had already read.
alter table conversation_reads
    add column last_delivered_at timestamptz;

update conversation_reads set last_delivered_at = last_read_at;

alter table conversation_reads
    alter column last_delivered_at set not null,
    alter column last_delivered_at set default now();
