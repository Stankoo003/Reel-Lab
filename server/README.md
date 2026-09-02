# ReelLab server

Spring Boot 4.1.1 · Java 21 · Postgres 17 · Flyway. Layered: `web → service → persistence`.

## Run

```bash
cp .env.example .env          # then edit; .env is gitignored
docker compose up -d          # Postgres on :5433

export JAVA_HOME=$(/usr/libexec/java_home -v 21)
set -a; . ./.env; set +a
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run
```

Health: `GET /actuator/health` · API under `/api`.

Tests need none of the above — only a Docker daemon:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
./mvnw test     # Testcontainers starts postgres:17-alpine; no compose, no .env
```

Port 5433, not 5432 — that one is commonly taken by another project's container.
`POSTGRES_PORT` feeds both the compose port mapping and the app's JDBC URL, so they
cannot drift apart.

## Schema, and why it looks like this

Four tables: `users`, `videos`, `comments`, `video_likes`. Ids are UUID, not `bigserial`: video ids
appear in URLs, and sequential ids let anyone enumerate `/videos/1,2,3…` and find
**unpublished** rows the moment an authorization check is imperfect.

| Relationship | On delete | Reasoning |
|---|---|---|
| `users → videos` | RESTRICT | A video row points at media files in object storage. Cascading a user delete would orphan those files silently. |
| `videos → comments` | CASCADE | A comment has no meaning without its video. |
| `users → comments` | RESTRICT | Same as videos. The alternative — nullable author with SET NULL — preserves thread shape and renders as "[deleted]"; worth revisiting once accounts can be deleted. |
| `comments → comments` | CASCADE | `parent_id NULL` = top-level. Deleting a comment removes its replies; orphaned replies are worse than lost ones. |
| `videos → video_likes` | CASCADE | Deleting a video should not leave orphaned counts behind. |
| `users → video_likes` | RESTRICT | Same as videos and comments. |

Several constraints do real work rather than documenting intent:

- **A reply must sit on its parent's video.** A plain FK cannot say that, so the parent
  reference is a *composite* key: `UNIQUE (id, video_id)` plus
  `FOREIGN KEY (parent_id, video_id) REFERENCES comments (id, video_id)`.
- **Media paths must be relative.** `CHECK` rejects any URI scheme or leading slash, so
  "no CDN URL in the database" is impossible to violate, not merely reviewed. `..` segments are
  rejected in the service (`MediaPaths`) — they satisfy both halves of "relative" and used to
  pass every check in the system.
- **One comment and one reply per author, per video.** `comments_one_per_author_uq` is
  `UNIQUE NULLS NOT DISTINCT (author_id, video_id, parent_id)`. Without `NULLS NOT DISTINCT`
  the NULL `parent_id` of a top-level comment would never compare equal, so a plain UNIQUE
  would limit replies correctly and let roots multiply freely. Postgres 15+.
- **One like per user, per video.** `video_likes_one_per_user_uq`, a plain UNIQUE — neither
  column is nullable, so the default semantics already do the job.
- **A bio fits in a paragraph, an avatar path is relative.** `users_bio_length` and
  `users_avatar_path_relative`.

Services pre-check these so callers get a clean 409 instead of a constraint violation, but the
pre-check is a courtesy: two concurrent requests both pass it. `GlobalExceptionHandler`
translates the violation into the same 409, so losing the race is not a 500.

The schema permits arbitrary reply nesting; the **API deliberately exposes two levels**,
because an unbounded recursive response is an availability problem. Depth is a schema
capability, not an API promise.

## Layering

`persistence` holds stored truth, `service` holds rules and knows nothing about HTTP,
`web` maps to DTOs. The boundary earns its keep concretely: `manifest_path` is **relative
in the database and absolute in the response** — `MediaUrlAssembler` composes the CDN base
from configuration. Change CDN host, or move to signed URLs, and only `web` changes.

`ArchitectureTest` fails the build on a violation, so this is enforced rather than agreed.
It has been checked in both directions: injecting a repository into a controller makes it
fail.

`spring.jpa.hibernate.ddl-auto=validate` is deliberate — entities and migrations disagree
loudly at startup instead of Hibernate quietly "fixing" the schema behind Flyway's back.

## Migrations

Everything in `db/migration/` always runs — `V1` (baseline) through `V6`.
`db/seed/V900__seed_dev.sql` is a **separate
Flyway location enabled only under the `dev` profile**, so seed data cannot reach a real
deployment through a migration that runs everywhere.

## Notes for whoever picks this up

- **Identity comes from the bearer token, never from the request.** There is no `authorId`,
  `ownerId`, `userId` or `viewerId` field left on any endpoint — a caller cannot name
  themselves, only prove who they are. Reads (`GET /api/videos/**`, `GET /api/users/**`) stay
  public and parse a token when one is sent, which is what answers `likedByViewer`; everything
  that writes requires one and checks ownership. See `config/SecurityConfig`.
- Tokens are HS256, signed and verified with `JWT_SECRET`. There is no refresh token, so
  `reellab.auth.ttl` is also how long a sign-in lasts. The secret has **no default**: an app
  that starts without one would issue forgeable tokens, so it refuses to start instead.
- 401 and 403 come out of the filter chain, before `@RestControllerAdvice` ever runs.
  `SecurityConfig` therefore writes its own `ProblemDetail` for both, so every error in the
  API has the same shape.
- Seeded dev accounts: `aleksa@example.com` and `mila@example.com`, password **`lozinka123`**.
  The BCrypt hash is in `V900__seed_dev.sql`, and `V7` backfills it onto rows that predate
  credentials.
- Services return entities and `web` maps them. Entities therefore do cross into `web`;
  what is forbidden (and tested) is `web` reaching for repositories. Introducing separate
  domain models in `service` is the next step if entity leakage starts to bite.
