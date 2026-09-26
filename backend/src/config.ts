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
  "OPENROUTER_API_KEY"
] as const;

// Every AI job picks its own model, because they differ a lot: translate and
// look up are two-word jobs where latency shows, the chat lives off a cached
// book prefix, and the dossier feeds a whole book in and wants 8k tokens out.
// All four default to what this app used before it went through OpenRouter, so
// an unset environment behaves exactly as it did.
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

// Only for the estimate shown BEFORE a dossier is generated - the cost of a
// call that already happened comes from OpenRouter itself. Defaults are Claude
// Sonnet 5's list price in USD per million tokens; override them when
// OPENROUTER_MODEL_DOSSIER points somewhere else, or the estimate describes a
// model that is not the one being asked.
const DEFAULT_DOSSIER_PRICE_IN = 2.0;
const DEFAULT_DOSSIER_PRICE_OUT = 10.0;

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

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
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY!,
    OPENROUTER_MODEL_TRANSLATE: process.env.OPENROUTER_MODEL_TRANSLATE || DEFAULT_MODEL,
    OPENROUTER_MODEL_LOOKUP: process.env.OPENROUTER_MODEL_LOOKUP || DEFAULT_MODEL,
    OPENROUTER_MODEL_CHAT: process.env.OPENROUTER_MODEL_CHAT || DEFAULT_MODEL,
    OPENROUTER_MODEL_DOSSIER: process.env.OPENROUTER_MODEL_DOSSIER || DEFAULT_MODEL,
    // "none" switches thinking off (what this code did directly before). A model
    // whose reasoning is mandatory rejects that, so "default" omits the
    // parameter and lets the model decide - see REASONING in providers/x/llm.ts.
    OPENROUTER_REASONING_EFFORT: process.env.OPENROUTER_REASONING_EFFORT || "none",
    DOSSIER_PRICE_IN_PER_MTOK: positiveNumber(
      process.env.DOSSIER_PRICE_IN_PER_MTOK,
      DEFAULT_DOSSIER_PRICE_IN,
      "DOSSIER_PRICE_IN_PER_MTOK"
    ),
    DOSSIER_PRICE_OUT_PER_MTOK: positiveNumber(
      process.env.DOSSIER_PRICE_OUT_PER_MTOK,
      DEFAULT_DOSSIER_PRICE_OUT,
      "DOSSIER_PRICE_OUT_PER_MTOK"
    )
  };
}

export const env = readEnv();
export const MAX_UNPACKED_EPUB_BYTES = 25 * 1024 * 1024; // ~25 MB, zip-bomb guard
