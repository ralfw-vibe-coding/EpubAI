import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableQueryError, withConnectionRetry, type QueryFn } from "../../src/providers/d/db.js";
import type pg from "pg";

function connectTimeoutError(): Error {
  return new Error("timeout exceeded when trying to connect");
}

function resetError(): Error {
  return new Error("Connection terminated unexpectedly");
}

function econnresetError(): Error {
  const err = new Error("read ECONNRESET") as Error & { code: string };
  err.code = "ECONNRESET";
  return err;
}

function sqlError(): Error {
  const err = new Error('duplicate key value violates unique constraint "book_user_hash_idx"') as Error & {
    code: string;
  };
  err.code = "23505";
  return err;
}

describe("isRetryableQueryError", () => {
  it("retries connection-phase errors for any statement, including writes", () => {
    expect(isRetryableQueryError("insert into book ...", connectTimeoutError())).toBe(true);
    expect(isRetryableQueryError("update book set ...", new Error("connect ECONNREFUSED 1.2.3.4:5432"))).toBe(true);
    expect(isRetryableQueryError("select 1", new Error("the database system is starting up"))).toBe(true);
  });

  it("retries reset-class errors only for SELECTs (a write might already have been applied)", () => {
    expect(isRetryableQueryError("select * from book", resetError())).toBe(true);
    expect(isRetryableQueryError("  SELECT 1", econnresetError())).toBe(true);
    expect(isRetryableQueryError("insert into annotation ...", resetError())).toBe(false);
    expect(isRetryableQueryError("update book set title = $1", econnresetError())).toBe(false);
    expect(isRetryableQueryError("delete from loan where id = $1", resetError())).toBe(false);
  });

  it("never retries SQL errors", () => {
    expect(isRetryableQueryError("select 1", sqlError())).toBe(false);
    expect(isRetryableQueryError("insert into book ...", sqlError())).toBe(false);
  });
});

describe("withConnectionRetry", () => {
  const okResult = { rows: [{ id: 1 }], rowCount: 1 } as unknown as pg.QueryResult<pg.QueryResultRow>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    return () => consoleError.mockRestore();
  });

  it("passes a successful query straight through", async () => {
    const run = vi.fn().mockResolvedValue(okResult);
    const query = withConnectionRetry(run as unknown as QueryFn, [0, 0]);
    await expect(query("select 1")).resolves.toBe(okResult);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a transient connect failure and succeeds on the second attempt (the Neon wake-up case)", async () => {
    const run = vi.fn().mockRejectedValueOnce(connectTimeoutError()).mockResolvedValue(okResult);
    const query = withConnectionRetry(run as unknown as QueryFn, [0, 0]);
    await expect(query("select * from book where user_id = $1", ["u1"])).resolves.toBe(okResult);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting the retry budget and rethrows the last error", async () => {
    const run = vi.fn().mockRejectedValue(connectTimeoutError());
    const query = withConnectionRetry(run as unknown as QueryFn, [0, 0]);
    await expect(query("select 1")).rejects.toThrow("timeout exceeded");
    expect(run).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
  });

  it("does not retry non-retryable errors (SQL error, or reset during a write)", async () => {
    const sqlRun = vi.fn().mockRejectedValue(sqlError());
    await expect(withConnectionRetry(sqlRun as unknown as QueryFn, [0, 0])("select 1")).rejects.toThrow(
      "duplicate key"
    );
    expect(sqlRun).toHaveBeenCalledTimes(1);

    const writeRun = vi.fn().mockRejectedValue(resetError());
    await expect(
      withConnectionRetry(writeRun as unknown as QueryFn, [0, 0])("insert into annotation ...")
    ).rejects.toThrow("terminated unexpectedly");
    expect(writeRun).toHaveBeenCalledTimes(1);
  });
});
