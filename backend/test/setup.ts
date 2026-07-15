// Test-only dummy configuration. Runs before any other module is imported, so
// config.ts (which never overrides already-set process.env values) always
// sees these test values instead of the real .env secrets.
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/testdb";
process.env.R2_BUCKET = "test-bucket";
process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-access-key-id";
process.env.R2_SECRET_ACCESS_KEY = "test-secret-access-key";
process.env.AUTH_SESSION_SECRET = "test-session-secret-not-real";
process.env.RESEND_API_KEY = "test-resend-api-key-not-real";
process.env.AUTH_FROM_EMAIL = "login@epubai.test";
process.env.AUTH_SECRET_OTP = "TESTOTP123";
process.env.JWT_TTL_SECONDS = "604800";
process.env.CLAUDE_API_KEY = "test-claude-api-key-not-real";
