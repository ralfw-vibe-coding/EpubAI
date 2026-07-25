import pg from "pg";
import { env } from "../../config.js";

const { Pool } = pg;

// Neon suspends its compute when idle; the very first connection attempt
// while it wakes back up is frequently dropped by Neon's proxy (reset/
// terminated), and only a subsequent attempt succeeds. A plain pg.Pool has
// no retry at all, so that first dropped connection surfaced as a 500 on
// whatever request happened to be first after a pause - seen as "internal
// error" on the catalog and "Konnte den Code nicht anfordern" on login.
// The pool below caps how long a connect may hang, closes idle clients
// before Neon kills them server-side, and pool.query retries transient
// connection-phase failures (see isRetryableQueryError).
const rawPool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000
});

// Without an 'error' listener, an idle pooled client killed server-side
// (exactly what happens when Neon suspends) raises an UNCAUGHT error event
// and can take the whole process/isolate down - pg's docs require this
// handler. Logging only; the pool discards the dead client by itself.
rawPool.on("error", (error) => {
  console.error("[db] Idle-Verbindung vom Server beendet (z.B. Neon-Suspend):", error.message);
});

// Failures during connection establishment - the statement never reached
// the server, so retrying is safe for ANY query, including writes.
const CONNECT_PHASE_PATTERNS = [
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "the database system is starting up",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT"
];

// Resets that can also strike mid-query. For reads that's still safe to
// retry; for writes it is not (the statement could have been applied right
// before the connection died), so these only retry SELECTs.
const RESET_PATTERNS = [
  "Connection terminated unexpectedly",
  "server closed the connection unexpectedly",
  "ECONNRESET",
  "EPIPE"
];

/**
 * Whether a failed query may be safely retried: connection-phase errors
 * always (the statement never ran), reset-class errors only for SELECTs
 * (a write might already have been applied when the connection died).
 * SQL errors (constraint violations, syntax, ...) are never retried.
 */
export function isRetryableQueryError(sql: string, error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  const haystack = `${err?.code ?? ""} ${err?.message ?? String(error)}`;
  if (CONNECT_PHASE_PATTERNS.some((p) => haystack.includes(p))) return true;
  const isRead = sql.trimStart().toLowerCase().startsWith("select");
  return isRead && RESET_PATTERNS.some((p) => haystack.includes(p));
}

const RETRY_DELAYS_MS: readonly number[] = [250, 750];

export type QueryFn = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  values?: unknown[]
) => Promise<pg.QueryResult<R>>;

/**
 * Wraps a query function with retry-on-transient-connection-error (the
 * classification lives in isRetryableQueryError). Exported as a factory so
 * the policy is unit-testable without a real pg pool.
 */
export function withConnectionRetry(run: QueryFn, delays: readonly number[] = RETRY_DELAYS_MS): QueryFn {
  return async (sql, values) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(sql, values);
      } catch (error) {
        if (attempt >= delays.length || !isRetryableQueryError(sql, error)) throw error;
        console.error(
          `[db] Transienter Verbindungsfehler (Versuch ${attempt + 1}/${delays.length + 1}), neuer Versuch in ${delays[attempt]}ms:`,
          error instanceof Error ? error.message : error
        );
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  };
}

/**
 * The repos' single database entry point. Deliberately exposes only
 * `query` - transactions/connect() would bypass the retry policy and are
 * not used anywhere; add them here (with thought) if that ever changes.
 */
export const pool = {
  query: withConnectionRetry((sql, values) => rawPool.query(sql, values))
};

export async function closePool(): Promise<void> {
  await rawPool.end();
}
