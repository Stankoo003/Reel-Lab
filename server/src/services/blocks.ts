import { sql } from "@/db/client";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { UserRow } from "./dto";
import { requireUserRow } from "./users";

export const CANNOT_BLOCK_SELF = "You cannot block yourself.";
/** Deliberately says nothing about WHO blocked whom. */
export const BLOCKED = "You can no longer message this person.";

export async function block(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new ValidationError(CANNOT_BLOCK_SELF);
  await requireUserRow(blockerId);
  await requireUserRow(blockedId);
  await sql`insert into user_blocks (blocker_id, blocked_id) values (${blockerId}::uuid, ${blockedId}::uuid)
            on conflict (blocker_id, blocked_id) do nothing`;
}

export async function unblock(blockerId: string, blockedId: string): Promise<void> {
  await sql`delete from user_blocks where blocker_id = ${blockerId}::uuid and blocked_id = ${blockedId}::uuid`;
}

export async function blockedBy(blockerId: string): Promise<UserRow[]> {
  return sql<UserRow[]>`
    select u.* from user_blocks b join users u on u.id = b.blocked_id
    where b.blocker_id = ${blockerId}::uuid order by b.created_at desc`;
}

/** Either direction: directional in storage, symmetric in effect. */
export async function isBlockedBetween(one: string, other: string): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`select exists (select 1 from user_blocks
    where (blocker_id = ${one}::uuid and blocked_id = ${other}::uuid)
       or (blocker_id = ${other}::uuid and blocked_id = ${one}::uuid))`;
  return row.exists;
}

export async function requireNotBlocked(one: string, other: string): Promise<void> {
  if (await isBlockedBetween(one, other)) throw new ForbiddenError(BLOCKED);
}
