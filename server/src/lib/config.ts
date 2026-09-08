/**
 * Runtime configuration, read once. Same variable names as the Spring backend where one
 * existed, so a .env written for it still works here.
 */

/** "30d", "45m", "1m", "250ms", "10s" → milliseconds. The shapes application.yml used. */
export function parseDuration(value: string | undefined, fallback: string): number {
  const raw = (value ?? fallback).trim();
  const m = /^(\d+)(ms|s|m|h|d)$/i.exec(raw);
  if (!m) throw new Error(`Unparseable duration "${raw}"`);
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case "ms": return n;
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    default: return n * 86_400_000;
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number(v) : fallback;
}

const env = process.env;

export const config = {
  get databaseUrl() { return required("DATABASE_URL"); },
  isServerless: Boolean(env.VERCEL),

  auth: {
    get secret() { return required("JWT_SECRET"); },
    ttlMs: parseDuration(env.JWT_TTL, "30d"),
  },

  media: {
    /**
     * The kill switch. "off" refuses every upload; "avatars" (the default) allows only
     * avatars, which are small, capped and one per user; "on" allows clips and posters too.
     * A free R2 bucket has a hard quota, and a server that accepts clips by default is a
     * server that fills it while nobody is looking.
     */
    uploads: (["off", "avatars", "on"].includes(env.MEDIA_UPLOADS ?? "") ? env.MEDIA_UPLOADS : "avatars") as "off" | "avatars" | "on",
    avatarMaxBytes: int("AVATAR_MAX_BYTES", 512 * 1024),
    cdnBaseUrl: (env.MEDIA_CDN_BASE_URL ?? "http://localhost:3000/media").replace(/\/$/, ""),
    storage: (env.MEDIA_STORAGE ?? "local") as "local" | "r2",
    directory: env.MEDIA_STORAGE_DIR ?? "../media",
    maxBytes: int("MEDIA_MAX_BYTES", 268_435_456),
    r2: {
      accountId: env.R2_ACCOUNT_ID ?? "",
      accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
      bucket: env.R2_BUCKET ?? "",
    },
  },

  mail: {
    provider: (env.MAIL_PROVIDER ?? "smtp") as "smtp" | "resend",
    from: env.MAIL_FROM ?? "ReelLab <no-reply@reellab.dev>",
    host: env.MAIL_HOST ?? "localhost",
    port: int("MAIL_PORT", 1025),
    smtpAuth: env.MAIL_SMTP_AUTH === "true",
    smtpUser: env.MAIL_USER ?? "",
    smtpPassword: env.MAIL_PASSWORD ?? "",
    resendApiKey: env.RESEND_API_KEY ?? "",
    webBaseUrl: (env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  },

  passwordReset: {
    ttlMs: parseDuration(env.PASSWORD_RESET_TTL, "45m"),
    perEmailLimit: int("PASSWORD_RESET_EMAIL_LIMIT", 3),
    perIpLimit: int("PASSWORD_RESET_IP_LIMIT", 10),
    windowMs: parseDuration(env.PASSWORD_RESET_WINDOW, "15m"),
    responseFloorMs: parseDuration(env.PASSWORD_RESET_FLOOR, "250ms"),
  },

  messaging: {
    sendLimit: int("DM_SEND_LIMIT", 20),
    sendWindowMs: parseDuration(env.DM_SEND_WINDOW, "1m"),
    pageSize: int("DM_PAGE_SIZE", 30),
  },
};
