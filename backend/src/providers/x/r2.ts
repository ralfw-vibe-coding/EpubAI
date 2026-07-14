import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { env } from "../../config.js";

// xProvider: Cloudflare R2 (S3-compatible object storage) for EPUB files.
//
// requestChecksumCalculation/responseChecksumValidation are pinned to
// "WHEN_REQUIRED" (the pre-3.729 SDK default) rather than the newer
// "WHEN_SUPPORTED" default: the newer default appends flexible-checksum
// query parameters (e.g. `x-amz-checksum-mode`) to presigned URLs, which R2
// does not support and rejects with a 403 the moment the URL is fetched by
// a plain client (curl, <img src>, ...) instead of the AWS SDK itself.
const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED"
});

export async function uploadObject(key: string, body: Buffer, contentType = "application/epub+zip"): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType })
  );
}

export async function headObject(key: string): Promise<{ sizeBytes: number } | null> {
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return { sizeBytes: result.ContentLength ?? 0 };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NotFound" || name === "NoSuchKey") return null;
    throw err;
  }
}

export async function getObjectStream(key: string): Promise<Readable> {
  const result = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  return result.Body as Readable;
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}

/**
 * Produces a time-limited, directly-fetchable URL for an object that is
 * otherwise not publicly readable. This is a local signature computation
 * (no network roundtrip), so it's cheap to call fresh on every request -
 * which is exactly what must happen, since a presigned URL is never stored
 * (it would go stale once its expiry passed).
 */
export async function getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
