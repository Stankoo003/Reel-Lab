/**
 * Cloudflare R2 through its S3-compatible API. The bucket is public-read behind
 * MEDIA_CDN_BASE_URL (an r2.dev URL or a custom domain); R2 answers Range requests, which is
 * what makes mp4 seeking work in the player.
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@/lib/config";
import type { MediaStorage, ObjectInfo } from "./index";

const PRESIGN_TTL_SECONDS = 15 * 60;

export class R2Storage implements MediaStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const r2 = config.media.r2;
    for (const [name, value] of Object.entries(r2)) {
      if (!value) throw new Error(`R2 storage selected but R2_${name.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()} is not set`);
    }
    this.bucket = r2.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    });
  }

  async presignPut(path: string, contentType: string, size: number) {
    // Content type and length are part of the signature, so the client cannot upload
    // something other than what it declared and was allowed.
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: path, ContentType: contentType, ContentLength: size });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return { uploadUrl, headers: { "Content-Type": contentType, "Content-Length": String(size) } };
  }

  async head(path: string): Promise<ObjectInfo | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: path }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
    } catch (e) {
      if ((e as { name?: string }).name === "NotFound" || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async readHead(path: string, length: number): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: path, Range: `bytes=0-${length - 1}` }));
      const bytes = await out.Body?.transformToByteArray();
      return bytes ?? null;
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(path: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: path }));
  }
}
