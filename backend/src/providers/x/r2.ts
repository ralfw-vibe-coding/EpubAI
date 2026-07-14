import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { env } from "../../config.js";

// xProvider: Cloudflare R2 (S3-compatible object storage) for EPUB files.
const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  }
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
