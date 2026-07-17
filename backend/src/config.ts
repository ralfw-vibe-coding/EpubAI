import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

// backend/src/config.ts -> repo root is two levels up from backend/src
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../");
dotenv.config({ path: path.join(repoRoot, ".env") });

// Optional environment overlay. `.env` is always the local/test environment;
// setting EPUBAI_ENV=production (etc.) layers `.env.<name>` on top, overriding
// only the keys it defines (for us: DATABASE_URL and R2_BUCKET). This keeps the
// default pointed at test - production is never reachable without an explicit,
// per-command opt-in, so it can't be left on by accident the way commenting
// lines in `.env` in and out could. On Deno Deploy there is no EPUBAI_ENV and
// no `.env.*` file, so this is a no-op there and the platform vars win.
const overlay = process.env.EPUBAI_ENV;
if (overlay) {
  const result = dotenv.config({ path: path.join(repoRoot, `.env.${overlay}`), override: true });
  if (result.error) {
    // A requested environment that can't be loaded must fail loudly, not
    // silently fall back to the test values in `.env`.
    throw new Error(`EPUBAI_ENV=${overlay} gesetzt, aber .env.${overlay} nicht ladbar: ${result.error.message}`);
  }
}

const REQUIRED_VARS = [
  "DATABASE_URL",
  "R2_BUCKET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "AUTH_SESSION_SECRET",
  "RESEND_API_KEY",
  "AUTH_FROM_EMAIL",
  "JWT_TTL_SECONDS",
  "CLAUDE_API_KEY"
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
    RESEND_API_KEY: process.env.RESEND_API_KEY!,
    AUTH_FROM_EMAIL: process.env.AUTH_FROM_EMAIL!,
    // Optional: a fixed local-dev "backdoor" code that always verifies,
    // alongside real per-user codes - deliberately not required, so it can
    // be left unset to disable it entirely (e.g. in a real deployment).
    AUTH_SECRET_OTP: process.env.AUTH_SECRET_OTP || null,
    JWT_TTL_SECONDS: ttl,
    PORT: Number(process.env.PORT ?? 3000),
    CLAUDE_API_KEY: process.env.CLAUDE_API_KEY!
  };
}

export const env = readEnv();
export const MAX_UNPACKED_EPUB_BYTES = 25 * 1024 * 1024; // ~25 MB, zip-bomb guard
