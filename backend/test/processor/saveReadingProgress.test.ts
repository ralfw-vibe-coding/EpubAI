import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/d/readingProgressRepo.js", () => ({
  findByUserAndBook: vi.fn(),
  upsert: vi.fn()
}));

import { saveReadingProgress } from "../../src/processor/saveReadingProgress.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as readingProgressRepo from "../../src/providers/d/readingProgressRepo.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book, ReadingProgress } from "../../src/domain/types.js";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    userId: "user-1",
    title: "T",
    author: "A",
    tags: [],
    coverUrl: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    currentFileHash: "hash-1",
    processingStatus: "ready",
    ...overrides
  } as Book;
}

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

describe("saveReadingProgress reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repos", async () => {
    const result = await saveReadingProgress(undefined, "book-1", { cfi: "cfi-1", percent: 10 });
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await saveReadingProgress(`Bearer ${token}`, "missing-book", { cfi: "cfi-1", percent: 10 });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(readingProgressRepo.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await saveReadingProgress(`Bearer ${token}`, "book-1", { cfi: "cfi-1", percent: 10 });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(readingProgressRepo.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body, never touching the repos", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());

    const result = await saveReadingProgress(`Bearer ${token}`, "book-1", { cfi: "   ", percent: 10 });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(readingProgressRepo.findByUserAndBook).not.toHaveBeenCalled();
    expect(readingProgressRepo.upsert).not.toHaveBeenCalled();
  });

  it("saves a first-time push (no existing entry) as-is and returns 200", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (readingProgressRepo.findByUserAndBook as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (readingProgressRepo.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProgress({ cfi: "cfi-1", percent: 10, page: 1, totalPages: 50 })
    );

    const result = await saveReadingProgress(`Bearer ${token}`, "book-1", {
      cfi: "cfi-1",
      percent: 10,
      page: 1,
      totalPages: 50
    });

    expect(readingProgressRepo.findByUserAndBook).toHaveBeenCalledWith("user-1", "book-1");
    expect(readingProgressRepo.upsert).toHaveBeenCalledWith("user-1", "book-1", {
      cfi: "cfi-1",
      percent: 10,
      page: 1,
      totalPages: 50
    });
    expect(result).toEqual({
      status: 200,
      body: makeProgress({ cfi: "cfi-1", percent: 10, page: 1, totalPages: 50 })
    });
  });

  it("overwrites a lower existing progress with a greater incoming one", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (readingProgressRepo.findByUserAndBook as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProgress({ cfi: "old-cfi", percent: 20, page: 2, totalPages: 50 })
    );
    (readingProgressRepo.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProgress({ cfi: "new-cfi", percent: 60, page: 6, totalPages: 50 })
    );

    const result = await saveReadingProgress(`Bearer ${token}`, "book-1", {
      cfi: "new-cfi",
      percent: 60,
      page: 6,
      totalPages: 50
    });

    expect(readingProgressRepo.upsert).toHaveBeenCalledWith("user-1", "book-1", {
      cfi: "new-cfi",
      percent: 60,
      page: 6,
      totalPages: 50
    });
    expect(result.status).toBe(200);
  });

  it("keeps the server's higher existing progress even though a lower one is pushed (the core conflict rule)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (readingProgressRepo.findByUserAndBook as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProgress({ cfi: "far-cfi", percent: 80, page: 40, totalPages: 50 })
    );
    (readingProgressRepo.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProgress({ cfi: "far-cfi", percent: 80, page: 40, totalPages: 50 })
    );

    const result = await saveReadingProgress(`Bearer ${token}`, "book-1", {
      cfi: "behind-cfi",
      percent: 15,
      page: 8,
      totalPages: 50
    });

    // The merged (winning existing) state is what gets persisted - not the pushed one.
    expect(readingProgressRepo.upsert).toHaveBeenCalledWith("user-1", "book-1", {
      cfi: "far-cfi",
      percent: 80,
      page: 40,
      totalPages: 50
    });
    expect(result).toEqual({
      status: 200,
      body: makeProgress({ cfi: "far-cfi", percent: 80, page: 40, totalPages: 50 })
    });
  });
});
