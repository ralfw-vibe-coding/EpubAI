import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

// backend/src/config.ts -> repo root is two levels up from backend/src
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../");
dotenv.config({ path: path.join(repoRoot, ".env") });

const REQUIRED_VARS = [
  "DATABASE_URL",
  "R2_BUCKET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "AUTH_SESSION_SECRET",
  "AUTH_SECRET_OTP",
  "JWT_TTL_SECONDS"
] as const;

function readEnv() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name] || process.env[name]!.length === 0);
  if (missing.length > 0) {
    // Never log values - only the names of the missing variables.
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const ttl = Number(process.env.JWT_TTL_SECONDS);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("JWT_TTL_SECONDS must be a positive number");
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    R2_BUCKET: process.env.R2_BUCKET!,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET!,
    AUTH_SECRET_OTP: process.env.AUTH_SECRET_OTP!,
    JWT_TTL_SECONDS: ttl,
    PORT: Number(process.env.PORT ?? 3000)
  };
}

export const env = readEnv();
export const MAX_UNPACKED_EPUB_BYTES = 25 * 1024 * 1024; // ~25 MB, zip-bomb guard
