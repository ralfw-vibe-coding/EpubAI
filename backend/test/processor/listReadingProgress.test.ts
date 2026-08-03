import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/readingProgressRepo.js", () => ({
  listByUser: vi.fn()
}));

import { listReadingProgress } from "../../src/processor/listReadingProgress.js";
import * as readingProgressRepo from "../../src/providers/d/readingProgressRepo.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { ReadingProgress } from "../../src/domain/types.js";

function makeProgress(overrides: Partial<ReadingProgress> = {}): ReadingProgress {
  return {
    bookId: "book-1",
    cfi: "cfi-1",
    percent: 42,
    page: 5,
    totalPages: 100,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("listReadingProgress reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await listReadingProgress(undefined);
    expect(result.status).toBe(401);
    expect(readingProgressRepo.listByUser).not.toHaveBeenCalled();
  });

  it("returns all of the caller's reading positions across every book", async () => {
    const token = sign({ userId: "user-1" });
    (readingProgressRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeProgress({ bookId: "book-1" }),
      makeProgress({ bookId: "book-2", percent: 10 })
    ]);

    const result = await listReadingProgress(`Bearer ${token}`);

    expect(readingProgressRepo.listByUser).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({
      status: 200,
      body: {
        progress: [
          makeProgress({ bookId: "book-1" }),
          makeProgress({ bookId: "book-2", percent: 10 })
        ]
      }
    });
  });

  it("returns an empty list when the user has no reading progress yet", async () => {
    const token = sign({ userId: "user-1" });
    (readingProgressRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await listReadingProgress(`Bearer ${token}`);

    expect(result).toEqual({ status: 200, body: { progress: [] } });
  });
});
