# ReelLab API (Next.js)

The backend the mobile app talks to, as Next.js route handlers, built to deploy on Vercel's
free tier with Postgres on Neon and media on Cloudflare R2. It replaces the Spring Boot server
that now lives in `../server-spring/` and keeps its REST contract, its database schema and its
token format — a database or a session from the old server works unchanged with this one.

## Layout

```
app/api/**/route.ts   the endpoints (one file per path; same paths as the Spring controllers)
app/actuator/health   {status, components.db} — what the Settings screen checks
app/reset             the web page a password-reset email opens
app/media/[...path]   serves the local media directory in development (Range supported)
src/lib               config, errors → ProblemDetail, JWT, cursors, rate limit, request schemas
src/services          the rules, one module per concept; every query lives here
src/storage           where uploaded bytes go: local disk or R2, behind one interface
src/mail              Mailpit over SMTP locally, Resend deployed
db/migration          the Flyway SQL files, verbatim, plus V14 (rate-limit table)
scripts/migrate.ts    applies them; adopts a database Flyway already migrated
```

## Run locally

```sh
cp .env.example .env            # then set JWT_SECRET (and keep it equal to the old server's)
docker compose up -d            # Postgres on :5433 and Mailpit on :8025
npm install
npm run migrate -- --seed       # schema + dev accounts (aleksa@example.com / mila@example.com, lozinka123)
npm run dev                     # http://localhost:3000
```

Point the app at it with `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000` and
`EXPO_PUBLIC_MEDIA_BASE_URL=http://localhost:3000/media` in the root `.env` (a physical device
needs the Mac's LAN address instead of localhost).

## Clip uploads are off by default

`MEDIA_UPLOADS` decides what `POST /api/media` will sign: `off` nothing, `avatars` (the
default) only avatars, `on` clips and posters too. A refused kind gets 403 *"Uploads are
switched off on this server."* before any bytes move, so a free R2 bucket cannot fill up by
accident; the app shows that message on the Post screen. Avatars are bounded on their own:
`AVATAR_MAX_BYTES` (512KB) per file, and the file a new avatar replaces is deleted from
storage, so a user occupies at most one. Everything else (feed, likes, comments, follows,
messages) works whatever the setting.

## What differs from the Spring server

- **Uploads are two-step.** `POST /api/media?kind=` takes `{contentType, size}` and answers
  `{path, uploadUrl, headers}`; the client PUTs the bytes to `uploadUrl` itself. A Vercel
  function accepts ~4.5MB of body and a clip is up to 256MB, so the server cannot proxy it.
  `POST /api/videos` and `PATCH /api/users/{id}` verify the object (existence, size, and for
  avatars the image magic bytes) when the path is attached.
- **No WebSocket.** `GET /api/conversations/{id}/updates?after=` returns `{messages,
  otherReceipt}` and the app polls it while a thread is open (`src/chat/socket.ts`).
  `/messages/since` still exists.
- **Rate limits live in Postgres** (`rate_limit_events`), not in memory, so they hold across
  serverless instances.
- No `/v3/api-docs`; `api/schema.d.ts` in the app is maintained by hand now.

Everything else — status codes, error bodies (`{detail, errors}`), cursor format, the Spring
`Page` envelope on `GET /api/videos`, the `pwd` claim that signs every device out on a password
change — is the same.

## Deploy (Vercel + Neon + R2)

1. **Neon**: create a project, copy the *pooled* connection string into `DATABASE_URL`.
   Run `DATABASE_URL=… npm run migrate` from your machine once (and again after any new
   migration).
2. **R2**: create a bucket, enable public access (r2.dev subdomain or a custom domain), create
   an API token with Object Read & Write. Set `MEDIA_STORAGE=r2`, the `R2_*` variables and
   `MEDIA_CDN_BASE_URL` to the public URL. No CORS is needed — uploads come from the native app.
3. **Resend**: verify a sending domain, set `MAIL_PROVIDER=resend`, `RESEND_API_KEY`,
   `MAIL_FROM` on that domain.
4. **Vercel**: import the repo with **Root Directory = `server`**, add every variable from
   `.env.example` (`PUBLIC_BASE_URL` = the deployment URL), deploy.
5. Point the app's `eas.json` production env at `https://<project>.vercel.app` and the R2
   public URL.

`GET /actuator/health` answers `{"status":"UP"}` when the database is reachable.
