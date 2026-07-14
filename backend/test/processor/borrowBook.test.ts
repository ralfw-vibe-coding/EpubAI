import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/d/loanRepo.js", () => ({
  insert: vi.fn()
}));

import { borrowBook } from "../../src/processor/borrowBook.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as loanRepo from "../../src/providers/d/loanRepo.js";
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

describe("borrowBook reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token", async () => {
    const result = await borrowBook(undefined, { bookId: "book-1", deviceId: "device-1" });
    expect(result.status).toBe(401);
  });

  it("returns 400 for a missing deviceId", async () => {
    const token = sign({ userId: "user-1" });
    const result = await borrowBook(`Bearer ${token}`, { bookId: "book-1", deviceId: "" });
    expect(result.status).toBe(400);
  });

  it("returns 404 when the book is not owned by the caller", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "other-user" }));

    const result = await borrowBook(`Bearer ${token}`, { bookId: "book-1", deviceId: "device-1" });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(loanRepo.insert).not.toHaveBeenCalled();
  });

  it("creates a loan using the book's current fileHash, not any client-supplied value", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (loanRepo.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "loan-1",
      bookId: "book-1",
      userId: "user-1",
      deviceId: "device-1",
      fileHash: "hash-1",
      borrowedAt: "2026-01-01T00:00:00.000Z",
      returnedAt: null
    });

    const result = await borrowBook(`Bearer ${token}`, { bookId: "book-1", deviceId: "device-1" });

    expect(loanRepo.insert).toHaveBeenCalledWith("user-1", {
      bookId: "book-1",
      deviceId: "device-1",
      fileHash: "hash-1"
    });
    expect(result).toEqual({
      status: 201,
      body: { id: "loan-1", bookId: "book-1", fileHash: "hash-1", borrowedAt: "2026-01-01T00:00:00.000Z" }
    });
  });
});
