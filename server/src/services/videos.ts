import { sql } from "@/db/client";
import { NotFoundError, requireSelf } from "@/lib/errors";
import { requireRelative } from "@/lib/media";
import { VIDEO_COLUMNS, videoResponse, type VideoResponse, type VideoRow } from "./dto";
import { followedAmong } from "./follows";
import { summarise } from "./likes";
import { requireUserRow } from "./users";


export async function requireVideo(id: string): Promise<VideoRow> {
  const rows = await sql.unsafe<VideoRow[]>(
    `select ${VIDEO_COLUMNS} from videos v join users u on u.id = v.owner_id where v.id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError("Video", id);
  return rows[0];
}

/** A clip that may be shared into a conversation: exists AND is published. Null for either. */
export async function findShareable(id: string): Promise<VideoRow | null> {
  const rows = await sql.unsafe<VideoRow[]>(
    `select ${VIDEO_COLUMNS} from videos v join users u on u.id = v.owner_id where v.id = $1 and v.published`, [id]);
  return rows[0] ?? null;
}

export type Page<T> = {
  content: T[]; totalElements: number; totalPages: number; size: number; number: number;
  numberOfElements: number; first: boolean; last: boolean; empty: boolean;
  sort: { sorted: boolean; unsorted: boolean; empty: boolean };
  pageable: { pageNumber: number; pageSize: number; offset: number; paged: boolean; unpaged: boolean;
    sort: { sorted: boolean; unsorted: boolean; empty: boolean } };
};

/** The offset listing, in the Spring `Page` envelope the client already reads. */
export async function list(publishedOnly: boolean, ownerId: string | null, page: number, size: number): Promise<Page<VideoRow>> {
  const where = ownerId ? sql`where v.owner_id = ${ownerId}::uuid` : publishedOnly ? sql`where v.published` : sql``;
  const [count] = await sql<{ n: number }[]>`select count(*)::int as n from videos v ${where}`;
  const rows = await sql<VideoRow[]>`
    select ${sql.unsafe(VIDEO_COLUMNS)} from videos v join users u on u.id = v.owner_id ${where}
    order by v.created_at desc, v.id desc limit ${size} offset ${page * size}`;
  const totalPages = Math.max(1, Math.ceil(count.n / size));
  const sort = { sorted: true, unsorted: false, empty: false };
  return {
    content: rows, totalElements: count.n, totalPages, size, number: page, numberOfElements: rows.length,
    first: page === 0, last: page >= totalPages - 1, empty: rows.length === 0, sort,
    pageable: { pageNumber: page, pageSize: size, offset: page * size, paged: true, unpaged: false, sort },
  };
}

export type FeedSlice = { videos: VideoRow[]; hasNext: boolean };

/** Published videos newest first, keyset on (created_at, id). One extra row says whether there is more. */
export async function feed(cursor: { createdAt: string; id: string } | null, limit: number): Promise<FeedSlice> {
  const rows = cursor
    ? await sql<VideoRow[]>`
        select ${sql.unsafe(VIDEO_COLUMNS)} from videos v join users u on u.id = v.owner_id
        where v.published and (v.created_at < ${cursor.createdAt}::timestamptz
          or (v.created_at = ${cursor.createdAt}::timestamptz and v.id < ${cursor.id}::uuid))
        order by v.created_at desc, v.id desc limit ${limit + 1}`
    : await sql<VideoRow[]>`
        select ${sql.unsafe(VIDEO_COLUMNS)} from videos v join users u on u.id = v.owner_id
        where v.published order by v.created_at desc, v.id desc limit ${limit + 1}`;
  const hasNext = rows.length > limit;
  return { videos: hasNext ? rows.slice(0, limit) : rows, hasNext };
}

export async function create(ownerId: string, title: string, description: string | null, durationSeconds: number,
                             manifestPath: string, posterPath: string | null): Promise<VideoRow> {
  await requireUserRow(ownerId);
  requireRelative("manifestPath", manifestPath);
  requireRelative("posterPath", posterPath);
  const [inserted] = await sql<{ id: string }[]>`
    insert into videos (owner_id, title, description, duration_seconds, manifest_path, poster_path)
    values (${ownerId}::uuid, ${title}, ${description}, ${durationSeconds}, ${manifestPath}, ${posterPath})
    returning id`;
  return requireVideo(inserted.id);
}

export async function setPublished(id: string, published: boolean, actor: string): Promise<VideoRow> {
  const video = await requireVideo(id);
  requireSelf(actor, video.owner_id, "video");
  await sql`update videos set published = ${published}, updated_at = now() where id = ${id}::uuid`;
  return requireVideo(id);
}

export async function remove(id: string, actor: string): Promise<void> {
  const video = await requireVideo(id);
  requireSelf(actor, video.owner_id, "video");
  await sql`delete from videos where id = ${id}::uuid`;
}

/** Like counts and follow flags for a page, then the DTOs — a handful of queries, not per row. */
export async function toResponses(rows: VideoRow[], viewerId: string | null): Promise<VideoResponse[]> {
  const [likes, followed] = await Promise.all([
    summarise(rows.map((v) => v.id), viewerId),
    followedAmong(rows.map((v) => v.owner_id), viewerId),
  ]);
  return rows.map((v) => videoResponse(v, likes.counts.get(v.id) ?? 0, likes.liked.has(v.id), followed.has(v.owner_id)));
}
