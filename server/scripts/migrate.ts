/**
 * Applies db/migration/V*.sql in version order, once each, recording what ran in
 * schema_migrations. `--seed` also applies db/seed/V*.sql (dev accounts and sample videos).
 *
 * The migration files are the Flyway ones the Spring backend used, verbatim — the schema
 * is the contract both backends share, so a database migrated by either can be used by this
 * server. Databases that already carry Flyway's history table are adopted: every version in
 * flyway_schema_history is treated as applied.
 *
 *   npm run migrate            # migrations only
 *   npm run migrate -- --seed  # plus the dev seed
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const seed = process.argv.includes("--seed");
const sql = postgres(url, { max: 1, onnotice: () => {} });

type Migration = { version: number; name: string; path: string };

function list(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^V\d+__.*\.sql$/.test(f))
    .map((f) => ({ version: Number(f.slice(1, f.indexOf("__"))), name: f, path: join(dir, f) }))
    .sort((a, b) => a.version - b.version);
}

async function main() {
  await sql`create table if not exists schema_migrations (
    version integer primary key,
    name varchar(200) not null,
    applied_at timestamptz not null default now()
  )`;

  const applied = new Set<number>(
    (await sql<{ version: number }[]>`select version from schema_migrations`).map((r) => r.version)
  );
  // A database the Spring backend migrated has Flyway's history instead. Adopt it.
  const flyway = await sql<{ exists: boolean }[]>`
    select exists (select 1 from information_schema.tables where table_name = 'flyway_schema_history')`;
  if (flyway[0]?.exists) {
    const rows = await sql<{ version: string; description: string }[]>`
      select version, description from flyway_schema_history where success and version is not null`;
    for (const row of rows) {
      const v = Number(row.version);
      if (!applied.has(v)) {
        await sql`insert into schema_migrations (version, name) values (${v}, ${"flyway:" + row.description})
                  on conflict do nothing`;
        applied.add(v);
      }
    }
  }

  const root = join(process.cwd(), "db");
  const pending = [...list(join(root, "migration")), ...(seed ? list(join(root, "seed")) : [])]
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const m of pending) {
    const body = readFileSync(m.path, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (version, name) values (${m.version}, ${m.name})`;
    });
    console.log(`applied ${m.name}`);
  }
  if (pending.length === 0) console.log("nothing to apply");
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
