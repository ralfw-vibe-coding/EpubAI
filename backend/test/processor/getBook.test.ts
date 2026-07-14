import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));

import { getBook } from "../../src/processor/getBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book } from "../../src/domain/types.js";

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
  };
}

describe("getBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token", async () => {
    const result = await getBook(undefined, "book-1");
    expect(result.status).toBe(401);
  });

  it("returns 404 when the book does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await getBook(`Bearer ${token}`, "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "someone-else" }));

    const result = await getBook(`Bearer ${token}`, "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("returns the book summary for the owner", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ tags: ["a"] }));

    const result = await getBook(`Bearer ${token}`, "book-1");
    expect(result).toEqual({
      status: 200,
      body: { id: "book-1", title: "T", author: "A", tags: ["a"], fileHash: "hash-1", processingStatus: "ready" }
    });
  });
});
