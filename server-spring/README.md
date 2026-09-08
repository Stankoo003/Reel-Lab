> **Legacy.** This is the Spring Boot backend ReelLab ran before the Next.js port in `../server/`.
> It is kept for reference (and its test suite), not deployed. The app now talks to `server/`.

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

## Email and password reset

`docker compose up -d` now starts **Mailpit** alongside Postgres. It accepts every message
and delivers none of them — read them at **http://localhost:8025**. That is what makes it
possible to click a real reset link in development without a real address, a verified domain,
or any chance of mailing a stranger from a test run.

Which provider is used is configuration, never code: everything that sends mail depends on
the `Mailer` interface, and `reellab.mail.provider` decides what is behind it.

| | local | deployed |
|---|---|---|
| `MAIL_PROVIDER` | `smtp` | `resend` |
| needs | the Mailpit container | `RESEND_API_KEY`, and a sending domain verified with Resend |

Trying it end to end:

```bash
curl -X POST localhost:8080/api/auth/password/reset-request \
  -H 'Content-Type: application/json' -d '{"email":"aleksa@example.com"}'
open http://localhost:8025          # the email, with its link
```

The link opens `GET /reset?token=…` — a page served by this application, which offers to
hand the token to the app (`reellab://reset-password?token=…`) and can finish the reset
itself for a recipient who does not have the app installed.

Things worth knowing before changing any of it:

- The request endpoint answers **identically** for a registered and an unregistered address:
  same status, same body, and the same elapsed time (`reellab.password-reset.response-floor`).
  Anything that makes the two distinguishable turns password reset into a way to discover
  which addresses have accounts.
- `password_resets` stores a **SHA-256 of the token**, never the token. A database dump is
  therefore not a set of working reset links.
- A completed reset moves `users.password_changed_at`, and every JWT carries the value it was
  issued under. Changing a password therefore signs out every existing session — see
  `TokenService.PASSWORD_CLAIM`.

## Direct messages

1:1, text only. History over HTTP, live updates over a socket.

```
GET    /api/conversations                     list, with last message and unread count
POST   /api/conversations                     open (or find) the thread with one person
GET    /api/conversations/{id}/messages       one page, newest first, cursor-paginated
GET    /api/conversations/{id}/messages/since what arrived after an instant — reconnect
POST   /api/conversations/{id}/messages       send
POST   /api/conversations/{id}/read           opening a thread reads it to the end
PUT    /api/users/{id}/block                  · DELETE to undo · GET /api/blocks to list
POST   /api/messages/{id}/report              records the message, the reporter, and the body
```

The socket is STOMP at `/ws`, registered `withSockJS()` — which also leaves the raw
`/ws/websocket` transport available, and that is the one the app uses, because sockjs-client
wants browser globals React Native does not have.

```
CONNECT    Authorization: Bearer <token>      on the FRAME, not the handshake
SUBSCRIBE  /topic/conversations/{id}          participation checked here, server-side
SUBSCRIBE  /user/queue/errors                 why a socket send was refused
SEND       /app/conversations/{id}/send       {"body": "...", "clientId": "..."}
```

### What holds it together

- **A conversation id from a client is a claim, not permission.** `ConversationService`
  `requireParticipant` is the only definition of "may see this thread", and every path —
  REST read, REST send, socket subscribe, socket send — goes through it.
- **An unauthenticated socket can do nothing.** The handshake is open at the HTTP layer
  because SockJS's transports have nowhere to put a header; what makes that safe is that
  `StompAuthInterceptor` refuses every SUBSCRIBE and SEND without the principal that CONNECT
  established.
- **Sending is HTTP, delivery is the socket.** An HTTP send has a status code, so "did it
  arrive" is answerable and a queued retry is safe. A frame written into a socket that is
  quietly dead is not.
- **The client reconciles on reconnect** with `messages/since` rather than trusting the live
  stream to have been complete — the server published to a topic nobody was listening on.
- **One conversation per pair**, enforced by a unique constraint over a canonically ordered
  pair of columns. Note that the ordering uses Postgres's uuid comparison, not Java's —
  see `ConversationEntity.compare`.
- **The broker is the in-memory one**, so it delivers only to sessions held by this instance.
  A second instance behind a load balancer needs a relay (RabbitMQ); it changes one method.

## Deploying

`Dockerfile` builds the API in two stages; `fly.toml` runs it on Fly.io. Nothing about the
code differs from local — the deployment is entirely environment.

Three things change shape once this is not on your laptop:

- **Media is served by the API itself**, from a volume, via `MediaResourceConfig`. Locally a
  separate static server on `:8090` does that job. Which one is in use is decided by
  `MEDIA_CDN_BASE_URL` alone; pointing it at R2 later retires the handler without removing it.
- **The volume is not optional.** Uploaded clips live on the container filesystem, which is
  discarded on every deploy. Without the mount, a tester's upload survives until the next
  time anything ships.
- **The `dev` profile must not be active.** It enables the seed migration and out-of-order
  Flyway. `fly.toml` sets `SPRING_PROFILES_ACTIVE=prod`, which matches no profile block on
  purpose — the effect is the plain configuration, strictly ordered, with no seed.

### First deploy

```bash
brew install flyctl
fly auth login

cd server
fly launch --no-deploy --copy-config      # keeps fly.toml as written
fly volumes create reellab_media --size 3 --region fra
fly postgres create --name reellab-db --region fra
fly postgres attach reellab-db            # sets DATABASE_URL — see the note below
```

Fly's `attach` sets `DATABASE_URL`, which this app does not read. It takes the five values
below instead, so set them from what `attach` printed:

```bash
fly secrets set \
  POSTGRES_HOST=reellab-db.internal \
  POSTGRES_PORT=5432 \
  POSTGRES_DB=reellab \
  POSTGRES_USER=... \
  POSTGRES_PASSWORD=... \
  JWT_SECRET="$(openssl rand -base64 48)" \
  RESEND_API_KEY=re_...

fly deploy
fly logs
```

`JWT_SECRET` is generated once and never changed casually: rotating it invalidates every
session on every device at once, which is a sign-out for the whole user base.

### Verifying

```bash
curl https://reellab-api.fly.dev/actuator/health      # status must be UP, db included
```

A `db` component that is `DOWN` means the five Postgres values above disagree with what
`attach` created — the app cannot fall back, because `application.yml` gives them no defaults
on purpose.
